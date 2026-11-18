/**
 * A question that is set up wrongly (the widget cannot save into it) is the manager's to catch: the widget, in its frame, cannot see the
 * host page. The manager then freezes the widget and says, above it, what is wrong and how teaching staff can fix it. One path for every
 * such problem, so they all look and behave the same: a message in the page's flow above the widget (not over it: a short widget's frame
 * can be smaller than the message), the widget blurred and not clickable, and the widget told to lock, with the same title.
 * Nothing offers a reload, which cannot fix a setting.
 */

/** What is wrong, for the teacher who can fix it (and the student who sees it): a title and a few short lines. */
export interface SetupProblem {
  /** Which problem it is (on the container as data-lms-setup-problem, for tests and for styling). */
  id: string;
  title: string;
  lines: string[];
}

const TITLE = 'Configuration issue: answers cannot be saved.';
const STUDENTS = 'Students: please tell your teacher.';

/** The words are Moodle's own (qtype_essay's language strings), so teaching staff can find the setting. */
export const SETUP_PROBLEMS = {
  /** An essay in "HTML editor" format: the editor reads the saved text as HTML, joins its lines, and saves its own copy over it. */
  htmlAnswerBox: {
    id: 'html-answer-box',
    title: TITLE,
    lines: [
      'This question\'s answer box is set to use the HTML editor, which damages saved answers, so the editor below is locked.',
      'Teaching staff can fix this: edit the question and, under Response options, set Response format to "Plain text" (or "Plain text, monospaced font"). Then start a new preview.',
      STUDENTS,
    ],
  },
  /** No answer box to save into: not an essay question, or its response format is "No online text". */
  noAnswerBox: {
    id: 'no-answer-box',
    title: TITLE,
    lines: [
      'This question has no answer box for the editor below to save into, so it is locked.',
      'Teaching staff can fix this: use an Essay question and, under Response options, set Response format to "Plain text" (not "No online text"). Then start a new preview.',
      STUDENTS,
    ],
  },
  /** Two widgets on one answer box: each would save over the other. */
  sharedAnswerBox: {
    id: 'shared-answer-box',
    title: TITLE,
    lines: [
      'This question has more than one editor saving into the same answer box, so this one is locked.',
      'Teaching staff can fix this: edit the question text so that it has only one editor (one answer box holds one answer). Then start a new preview.',
      STUDENTS,
    ],
  },
} satisfies Record<string, SetupProblem>;

/**
 * Shows the problem above `container` and freezes the widget in it. `lockWidget` tells the widget to lock (the controller's messenger
 * does it when there is one); without it the widget is told directly: a frame by message, an element by event.
 */
export function showSetupProblem(container: HTMLElement, problem: SetupProblem, lockWidget?: (message: string) => void): void {
  if (container.hasAttribute('data-lms-setup-problem')) return;
  container.setAttribute('data-lms-setup-problem', problem.id);
  container.setAttribute('data-lms-widget-initialized', 'error');

  const widget = container.querySelector<HTMLElement>('[data-lms-widget]') || container.querySelector<HTMLElement>('iframe') || container;
  widget.style.pointerEvents = 'none';
  widget.style.filter = 'blur(2px)';
  widget.style.opacity = '0.3';
  widget.style.userSelect = 'none';
  (lockWidget ?? ((message) => tellWidgetToLock(widget, message)))(problem.title);

  // Built from elements and text, never from HTML: the words are shown as written, whatever they contain
  const doc = container.ownerDocument;
  const element = (tag: string, style: string, text?: string): HTMLElement => {
    const node = doc.createElement(tag);
    node.style.cssText = style;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const content = [
    element('strong', 'display: block; font-size: 17px; margin-bottom: 8px;', `⚠️ ${problem.title}`),
    ...problem.lines.map((line, i) => element('p', i === problem.lines.length - 1 ? 'margin: 0;' : 'margin: 0 0 8px 0;', line)),
  ];

  // A page that gave the widget its own place for errors gets the message there
  const errorSlot = container.querySelector<HTMLElement>('[data-lms-error-slot]');
  if (errorSlot) {
    errorSlot.replaceChildren(...content);
    errorSlot.style.display = 'block';
    return;
  }
  const banner = element('div', `margin: 0 0 12px 0; background-color: var(--lms-widget-error-bg, #b71c1c); color: var(--lms-widget-error-text, #ffffff);
    padding: 16px 20px; border-radius: 8px; border: 2px solid var(--lms-widget-error-border, #ef5350); text-align: left; box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.45;`);
  banner.className = 'lms-widget-setup-error';
  banner.setAttribute('role', 'alert');
  banner.append(...content);
  if (container.parentNode) container.parentNode.insertBefore(banner, container);
  else container.prepend(banner);
}

/** The widget's own lock, with no controller to ask (the same messages the messengers send on lockdown). */
function tellWidgetToLock(widget: HTMLElement, message: string): void {
  try {
    if (widget.tagName.toLowerCase() === 'iframe') {
      (widget as HTMLIFrameElement).contentWindow?.postMessage({ type: 'ERROR_LOCKDOWN', payload: { message } }, '*');
    } else {
      widget.dispatchEvent(new CustomEvent('widget:lockdown', { detail: { message }, bubbles: true, composed: true }));
    }
  } catch {
    // Best effort: the widget is frozen and the message shown either way
  }
}
