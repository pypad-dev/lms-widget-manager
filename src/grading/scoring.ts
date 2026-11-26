/**
 * The scoring rules for grading with a widget's checks, with nothing of any LMS in them: from what each check passed or failed and what it is worth, the mark to suggest (the points of the
 * checks passed ÷ the points of them all × the question's maximum mark; a check that does not say is worth 1) and the comment to write (which passed, and why the others did not).
 */

export interface CheckResult { id: string; name: string; passed: boolean; message: string; /** What the check is worth (1 if not given: a PyPad from before points). */ points?: number }
export interface ChecksAnswer { checks: CheckResult[]; passed: number; total: number }

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
