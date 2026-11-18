/**
 * How an answer is written into the host's answer box, and read back. The widget hands the manager text; the manager knows only how
 * the host stores it. A real Moodle (4.5, essay question, plain-text response) keeps plain text intact apart from the browser's CRLF
 * line endings, so `plain` is the default. `base64` is for boxes where something cleans or rewrites the text.
 *
 * Reading never needs to be told which codec wrote an answer: every codec's output can be told apart, so changing the default
 * never strands answers already stored.
 */
export type AnswerFormat = 'plain' | 'base64';

export const DEFAULT_ANSWER_FORMAT: AnswerFormat = 'plain';
const BASE64_PREFIX = 'LMS_WIDGET_BASE64:';

export function isAnswerFormat(value: unknown): value is AnswerFormat {
  return value === 'plain' || value === 'base64';
}

/** Text for the answer box. */
export function encodeAnswer(content: string, format: AnswerFormat): string {
  if (format === 'plain') return content;
  try {
    return BASE64_PREFIX + btoa(unescape(encodeURIComponent(content)));
  } catch (e) {
    console.warn('[AnswerCodec] base64 encoding failed, storing plain text', e);
    return content;
  }
}

/** The text an answer box holds, whichever codec wrote it. */
export function decodeAnswer(stored: string): string {
  if (!stored.startsWith(BASE64_PREFIX)) return stored;
  try {
    return decodeURIComponent(escape(atob(stored.substring(BASE64_PREFIX.length))));
  } catch (e) {
    console.warn('[AnswerCodec] base64 decoding failed, returning the stored text unchanged', e);
    return stored;
  }
}
