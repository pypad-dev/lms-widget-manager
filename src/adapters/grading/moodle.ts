/**
 * Moodle's side of grading (the marker's *Manual grading* report, or one answer's comment page): where an answer's boxes are, what the author left in the grader information, and how to
 * write into them. The scoring rules are src/grading/scoring.ts and know nothing of Moodle.
 *
 * Moodle names the fields of one answer from the same prefix (question/behaviour/rendererbase.php, `manual_comment_fields`): the answer `q12:3_answer`, its mark `q12:3_-mark`,
 * its maximum `q12:3_-maxmark` (hidden), its comment `q12:3_-comment` (a textarea, id `q12:3_-comment_id`, made into an editor: TinyMCE, or Atto before Moodle 5).
 */

import type { GradingAdapter, GradingFields } from '../../grading/adapter';

export type { GradingFields };

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

/** Moodle's pages as a grading adapter. */
export const moodleGradingAdapter: GradingAdapter = {
  fieldsFor(mount, answerName, doc) {
    const prefix = answerPrefix(mount, answerName);
    return prefix ? gradingFields(doc, prefix) : null;
  },
  payloadFor(mount) {
    const block = mount.closest('.que');
    return block ? authorNotebookIn(block) : null;
  },
  hasWork: (fields) => hasText(fields.mark?.value) || hasText(fields.comment?.value),
  setMark: (fields, mark) => { if (fields.mark) setFieldValue(fields.mark, mark); },
  setComment: (fields, html) => { if (fields.comment) writeComment(fields.comment, html); },
};
