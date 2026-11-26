/**
 * What grading needs of a page, which only an LMS knows: where an answer's mark and comment boxes are, what the author left for its widget, what a marker has already put in, and how to
 * write into the boxes. An LMS gives these in an adapter (Moodle's: src/adapters/grading/moodle.ts); the grading code itself names no LMS.
 */

/** One answer's boxes. */
export interface GradingFields {
  mark: HTMLInputElement | null;
  /** The question's maximum mark, where the page says it. */
  maxMark: number | null;
  comment: HTMLTextAreaElement | null;
}

export interface GradingAdapter {
  /** The boxes of the answer a widget is in (`mount` is its container; `answerName` the name of its answer field, if it has one); null if this is not an answer the page marks. */
  fieldsFor(mount: Element, answerName: string | null, doc: Document): GradingFields | null;
  /** The text the author left for this answer's widget (what to grade with), where the page keeps one; null if there is none. */
  payloadFor(mount: Element): string | null;
  /** Whether a marker has already put a mark or a comment in. */
  hasWork(fields: GradingFields): boolean;
  /** Writes the mark and the comment as if typed (the page's own form and scripts see them). Nothing is saved. */
  setMark(fields: GradingFields, mark: string): void;
  setComment(fields: GradingFields, html: string): void;
}
