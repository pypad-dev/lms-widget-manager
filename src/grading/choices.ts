/**
 * The marker's two choices on a grading page, kept in the bar above the answers and read by the buttons (the one for all, and the one on each answer): whether to write over a mark or
 * comment already there, and whether to fill in the comment only. The comment-only choice is remembered in this browser.
 */

export interface GradingChoices {
  replace: boolean;
  commentsOnly: boolean;
}

export const REPLACE_ID = 'lms-widget-grading-replace';
export const FILL_ID = 'lms-widget-grading-fill';
const STORED = 'lms-widget-grading-fill';

export type Fill = 'marks-and-comments' | 'comments-only';

/** The choices as the bar shows them now (neither, where there is no bar). */
export function readChoices(doc: Document): GradingChoices {
  const replace = doc.getElementById(REPLACE_ID) as HTMLInputElement | null;
  const fill = doc.getElementById(FILL_ID) as HTMLSelectElement | null;
  return { replace: replace?.checked === true, commentsOnly: fill?.value === 'comments-only' };
}

/** What the marker chose last time in this browser. */
export function storedFill(): Fill {
  try { return window.localStorage.getItem(STORED) === 'comments-only' ? 'comments-only' : 'marks-and-comments'; } catch { return 'marks-and-comments'; }
}

export function storeFill(fill: Fill): void {
  try { window.localStorage.setItem(STORED, fill); } catch { /* storage may be off: the choice just is not kept */ }
}
