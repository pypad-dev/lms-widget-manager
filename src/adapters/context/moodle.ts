import { IContextAdapter, RunMode } from '../../interfaces/contracts';
import { SETUP_PROBLEMS, type SetupProblem } from '../../core/setup-problem';

/**
 * Context adapter specifically designed for Moodle LMS.
 * Inspects Moodle DOM elements, URL parameters, and data-lms-* attributes to deduce:
 * - RunMode ('edit' | 'attempt' | 'grade' | 'review')
 * - Read-only status
 */
export class MoodleContextAdapter implements IContextAdapter {
  private mountPoint?: HTMLElement | null;
  private textarea?: HTMLTextAreaElement | null;

  constructor(mountPoint?: HTMLElement | null, textarea?: HTMLTextAreaElement | null) {
    this.mountPoint = mountPoint;
    this.textarea = textarea;
  }

  /**
   * Deduces the current execution state based on Moodle URLs and DOM elements.
   */
  public getRunMode(): RunMode {
    // 1. Explicit data-lms-run-mode attribute override
    const explicitMode = this.mountPoint?.getAttribute('data-lms-run-mode');

    if (
      explicitMode === 'edit' ||
      explicitMode === 'attempt' ||
      explicitMode === 'grade' ||
      explicitMode === 'review'
    ) {
      return explicitMode;
    }

    const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
    const pathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
    const search = typeof window !== 'undefined' && window.location ? window.location.search : '';

    // 2. Authoring / Edit Mode (mode: 'edit')
    // Detected via Moodle question editing URLs
    if (
      pathname.includes('/question/question.php') ||
      pathname.includes('/question/bank/editquestion/') ||
      url.includes('/question/question.php') ||
      url.includes('/question/bank/editquestion/')
    ) {
      return 'edit';
    }

    // 3. Manual Grading Mode (mode: 'grade')
    // Detected via quiz grading report URL OR presence of an active, visible Moodle grading comment box in the DOM
    // (a marker's own page for one answer, /mod/quiz/comment.php, is a grading page too)
    const isGradingUrl =
      ((pathname.includes('/mod/quiz/report.php') || url.includes('/mod/quiz/report.php')) &&
        search.includes('mode=grading')) ||
      pathname.includes('/mod/quiz/comment.php');

    const questionContainer =
      this.mountPoint?.closest('.que, .form-item, form, body') || document.body;

    const gradingElement = questionContainer?.querySelector<HTMLElement>(
      '.comment-area, .gradingform, .qtype_essay_response_form, .commenttext'
    );

    const hasVisibleGradingForm = Boolean(
      gradingElement &&
      gradingElement.style.display !== 'none' &&
      !gradingElement.hidden &&
      (typeof window === 'undefined' ||
        !window.getComputedStyle ||
        window.getComputedStyle(gradingElement).display !== 'none')
    );

    if (isGradingUrl || hasVisibleGradingForm) {
      return 'grade';
    }

    // 4. Post-Assessment Review Mode (mode: 'review')
    // Detected via quiz review URL or locked textarea when not in grading mode
    const isReviewUrl =
      pathname.includes('/mod/quiz/review.php') || url.includes('/mod/quiz/review.php');

    const isTextareaReadOnly =
      this.textarea?.readOnly ||
      this.textarea?.disabled ||
      this.textarea?.getAttribute('aria-disabled') === 'true' ||
      this.mountPoint?.getAttribute('data-lms-readonly') === 'true';

    if (isReviewUrl || (isTextareaReadOnly && !isGradingUrl && !hasVisibleGradingForm)) {
      return 'review';
    }

    // 5. Student Attempt Mode (mode: 'attempt') - Default
    return 'attempt';
  }

  /**
   * Deduces whether the context mandates read-only behavior.
   */
  public isReadOnly(): boolean {
    if (this.mountPoint?.getAttribute('data-lms-readonly') === 'true') {
      return true;
    }

    const mode = this.getRunMode();
    if (mode === 'review') {
      return true;
    }

    if (
      this.textarea?.readOnly ||
      this.textarea?.disabled ||
      this.textarea?.getAttribute('aria-disabled') === 'true'
    ) {
      return true;
    }

    return false;
  }
}

/** Moodle's value for "Plain text" in an answer's format field (`<name>format`): FORMAT_PLAIN in lib/weblib.php. */
const MOODLE_FORMAT_PLAIN = '2';

/**
 * What is wrong with this answer box, or null when it can keep a notebook. A notebook is saved as plain text, so the essay's response
 * format must be "Plain text" (or "Plain text, monospaced font"). With "HTML editor" Moodle puts an editor (TinyMCE, Atto) over the box:
 * the editor reads what the widget writes as HTML, joins its lines, and saves its own copy over it, so the answer is lost or damaged
 * (seen in Moodle 4.5 with TinyMCE).
 */
export function htmlAnswerBoxProblem(textarea: HTMLTextAreaElement): SetupProblem | null {
  const formatField = textarea.name ? textarea.ownerDocument.getElementsByName(`${textarea.name}format`)[0] as HTMLInputElement | undefined : undefined;
  const isHtml = formatField ? formatField.value !== MOODLE_FORMAT_PLAIN : Boolean(textarea.closest('.qtype_essay_editor, .qtype_essay_editorfilepicker'));
  return isHtml ? SETUP_PROBLEMS.htmlAnswerBox : null;
}
