/**
 * Grading with a widget's checks (a Moodle grading page: the marker's *Manual grading* report, or one answer's comment page).
 *
 * A widget that can run its question's checks (PyPad's `checks` request) says which passed, and what each is worth; from that a mark is suggested (the points of the checks
 * passed ÷ the points of them all × the question's maximum mark; a check that does not say is worth 1) and a comment written (which passed, and why the others did not), into the answer's own mark and comment fields. Nothing is saved: the marker reads, changes and saves as always.
 *
 * Moodle names the fields of one answer from the same prefix (question/behaviour/rendererbase.php, `manual_comment_fields`): the answer `q12:3_answer`, its mark `q12:3_-mark`,
 * its maximum `q12:3_-maxmark` (hidden), its comment `q12:3_-comment` (a textarea, id `q12:3_-comment_id`, made into an editor: TinyMCE, or Atto before Moodle 5).
 */

export interface CheckResult { id: string; name: string; passed: boolean; message: string; /** What the check is worth (1 if not given: a PyPad from before points). */ points?: number }
export interface ChecksAnswer { checks: CheckResult[]; passed: number; total: number }

export interface GradingFields {
  mark: HTMLInputElement | null;
  maxMark: number | null;
  comment: HTMLTextAreaElement | null;
}

/** The prefix of an answer's fields, from the answer's own field name (`q12:3_answer` → `q12:3_`); null for a name Moodle did not make. */
export function fieldPrefix(answerName: string | null | undefined): string | null {
  const match = /^(q\d+:\d+_)/.exec(answerName ?? '');
  return match ? match[1] : null;
}

/**
 * The prefix of an answer's fields. Moodle 4.5's marking page gives the answer's read-only textarea no name, so the prefix is taken from the answer's own block (`div.que`): from a mark or
 * comment field in it (the fields of this answer and no other), or from the block's id (`question-12-3` → `q12:3_`); the textarea's name is the fallback for a page laid out otherwise.
 */
export function answerPrefix(mount: Element | null | undefined, answerName: string | null | undefined): string | null {
  const block = mount?.closest('.que') ?? null;
  if (block) {
    for (const field of block.querySelectorAll('[name$="_-mark"], [name$="_-comment"], [name$="_-maxmark"]')) {
      const match = /^(q\d+:\d+_)-(?:mark|comment|maxmark)$/.exec(field.getAttribute('name') ?? '');
      if (match) return match[1];
    }
  }
  const named = fieldPrefix(answerName);
  if (named) return named;
  const id = /^question-(\d+)-(\d+)$/.exec(block?.id ?? '');
  return id ? `q${id[1]}:${id[2]}_` : null;
}

/** The answer's mark, maximum and comment fields in `doc`, as Moodle names them. */
export function gradingFields(doc: Document, prefix: string): GradingFields {
  if (!/^q\d+:\d+_$/.test(prefix)) return { mark: null, maxMark: null, comment: null };       // (only a prefix Moodle makes: then it needs no escaping in a selector)
  const named = <T extends Element>(name: string): T | null => doc.querySelector<T>(`[name="${prefix}${name}"]`);
  const max = named<HTMLInputElement>('-maxmark');
  const value = max ? Number(max.value) : NaN;
  return { mark: named<HTMLInputElement>('-mark'), maxMark: Number.isFinite(value) ? value : null, comment: named<HTMLTextAreaElement>('-comment') };
}

/** What a check is worth: its points, or 1 when it does not say (or says something that is not a number of 0 or more). */
export function pointsOf(check: Pick<CheckResult, 'points'>): number {
  return typeof check.points === 'number' && Number.isFinite(check.points) && check.points >= 0 ? check.points : 1;
}

/** The points of the checks passed, and of them all. */
export function score(checks: readonly CheckResult[]): { gained: number; possible: number } {
  let gained = 0;
  let possible = 0;
  for (const check of checks) {
    const points = pointsOf(check);
    possible += points;
    if (check.passed) gained += points;
  }
  return { gained, possible };
}

const pointsText = (n: number): string => `${n} point${n === 1 ? '' : 's'}`;

/** The mark the checks suggest: the share gained (of points, or of checks) of the maximum, to two places (Moodle's own precision for a manual mark). */
export function suggestedMark(passed: number, total: number, maxMark: number): number {
  if (total <= 0) return 0;
  return Math.round((passed / total) * maxMark * 100) / 100;
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The comment: a line that says it was suggested, then each check, passed or not, with its points and the reason for one that did not. */
export function commentHtml(answer: ChecksAnswer): string {
  const rows = answer.checks.map((check) =>
    `<li>${check.passed ? '✔' : '✘'} ${escape(check.name)} (${pointsText(pointsOf(check))})${check.passed || !check.message ? '' : `: <code>${escape(check.message)}</code>`}</li>`).join('');
  const { gained, possible } = score(answer.checks);
  return `<p><strong>Suggested from the tests</strong>: ${answer.passed} of ${answer.total} passed (${gained} of ${pointsText(possible)}).</p><ul>${rows}</ul>`;
}

/** Puts a value in a field as if it had been typed (the form and Moodle's own scripts see the change). */
export function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

interface TinyEditor { setContent(html: string): void; save(): void; fire?(name: string): void }

/** Writes `html` into an answer's comment: through its editor when it has one (TinyMCE; Atto's editable area), and into the textarea the form sends. */
export function writeComment(comment: HTMLTextAreaElement, html: string): void {
  const view = comment.ownerDocument.defaultView as (Window & { tinymce?: { get(id: string): TinyEditor | null } }) | null;
  const tiny = view?.tinymce?.get(comment.id) ?? null;
  if (tiny) {
    tiny.setContent(html);
    tiny.save();                                                                   // (the textarea the form sends)
    tiny.fire?.('change');
    return;
  }
  const atto = comment.ownerDocument.getElementById(`${comment.id}editable`);
  if (atto) atto.innerHTML = html;
  setFieldValue(comment, html);
}

/** The author's notebook in an answer's block on the grading page: Moodle draws the question's grader information (`div.graderinfo`) in the answer's own block, and PyPad's question builder
 * puts the notebook, with the tests the author keeps from students, in a script block there. Null where there is none. */
export function authorNotebookIn(block: Element): string | null {
  const script = block.querySelector('.graderinfo script[type="text/x-pypad-author"]');
  if (!script) return null;
  return (script.textContent ?? '').replace(/<\\\/(script)/gi, '</$1').replace(/^\n/, '').replace(/\n$/, '');
}

/** Whether a mark or comment box already has something in it (a comment's editor holds an empty paragraph when it is empty). */
export function hasText(value: string | null | undefined): boolean {
  return (value ?? '').replace(/<[^>]*>|&nbsp;|\s+/g, '') !== '';
}
