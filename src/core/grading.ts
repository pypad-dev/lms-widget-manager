/**
 * Grading with a widget's checks (a Moodle grading page: the marker's *Manual grading* report, or one answer's comment page).
 *
 * A widget that can run its question's checks (PyPad's `checks` request) says which passed; from that a mark is suggested (passed ÷ total × the question's maximum mark) and a
 * comment written (which passed, and why the others did not), into the answer's own mark and comment fields. Nothing is saved: the marker reads, changes and saves as always.
 *
 * Moodle names the fields of one answer from the same prefix (question/behaviour/rendererbase.php, `manual_comment_fields`): the answer `q12:3_answer`, its mark `q12:3_-mark`,
 * its maximum `q12:3_-maxmark` (hidden), its comment `q12:3_-comment` (a textarea, id `q12:3_-comment_id`, made into an editor: TinyMCE, or Atto before Moodle 5).
 */

export interface CheckResult { id: string; name: string; passed: boolean; message: string }
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

/** The answer's mark, maximum and comment fields in `doc`, as Moodle names them. */
export function gradingFields(doc: Document, prefix: string): GradingFields {
  if (!/^q\d+:\d+_$/.test(prefix)) return { mark: null, maxMark: null, comment: null };       // (only a prefix Moodle makes: then it needs no escaping in a selector)
  const named = <T extends Element>(name: string): T | null => doc.querySelector<T>(`[name="${prefix}${name}"]`);
  const max = named<HTMLInputElement>('-maxmark');
  const value = max ? Number(max.value) : NaN;
  return { mark: named<HTMLInputElement>('-mark'), maxMark: Number.isFinite(value) ? value : null, comment: named<HTMLTextAreaElement>('-comment') };
}

/** The mark the checks suggest: the share that passed of the maximum, to two places (Moodle's own precision for a manual mark). */
export function suggestedMark(passed: number, total: number, maxMark: number): number {
  if (total <= 0) return 0;
  return Math.round((passed / total) * maxMark * 100) / 100;
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The comment: a line that says it was suggested, then each check, passed or not, with the reason for one that did not. */
export function commentHtml(answer: ChecksAnswer): string {
  const rows = answer.checks.map((check) =>
    `<li>${check.passed ? '✔' : '✘'} ${escape(check.name)}${check.passed || !check.message ? '' : `: <code>${escape(check.message)}</code>`}</li>`).join('');
  return `<p><strong>Suggested from the tests</strong>: ${answer.passed} of ${answer.total} passed.</p><ul>${rows}</ul>`;
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
