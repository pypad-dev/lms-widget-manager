/**
 * Runs the checks of every answer on a grading page and fills in the suggested marks and comments (src/grading/scoring.ts has the rules). A few answers at a time, so a page of
 * many answers does not ask the browser for many Pythons at once; the widgets also keep to a budget of their own. Nothing is saved: the marker reads and saves.
 */

import type { WidgetController } from '../core/widget-controller';
import { moodleGradingAdapter } from '../adapters/grading/moodle';
import type { GradingAdapter } from './adapter';
import { commentHtml, score, suggestedMark, type ChecksAnswer, type TestsSource } from './scoring';

export type Outcome =
  | { status: 'marked'; passed: number; total: number; from: TestsSource }
  | { status: 'no-tests' }
  | { status: 'kept' }
  | { status: 'missing-tests' }
  | { status: 'no-fields' }
  | { status: 'failed'; reason: string };

export interface RunOptions {
  /** How many answers are tested at once (default 2). */
  concurrency?: number;
  /** The page's side (default: Moodle's). */
  adapter?: GradingAdapter;
  /** Write over a mark or comment the marker has already put in (default: leave an answer that has either as it is). */
  replace?: boolean;
  /** Fill in the comment only, and leave the mark box as it is (the marker's own mark stands; a mark already there does not count as work). */
  commentsOnly?: boolean;
  /** Told after each answer: how many are done, of how many. */
  onProgress?(done: number, total: number): void;
}

/** Tests one answer and fills in its fields. */
export async function testAnswer(controller: WidgetController, doc: Document, options: { replace?: boolean; commentsOnly?: boolean; adapter?: GradingAdapter } = {}): Promise<Outcome> {
  const adapter = options.adapter ?? moodleGradingAdapter;
  const mount = controller.getMountPoint();
  const fields = adapter.fieldsFor(mount, controller.getFieldName(), doc);
  if (!fields || (options.commentsOnly ? !fields.comment : !fields.mark && !fields.comment)) return { status: 'no-fields' };
  const tests = adapter.payloadFor(mount);                                        // (the author's tests, from where the page keeps them, in place of any in the student's notebook)
  if (!tests && adapter.requiresPayload?.(mount)) return { status: 'missing-tests' };   // (the question says they are there: marking from fewer would look the same, and be wrong)
  if (!options.replace && adapter.hasWork(fields, options.commentsOnly ? 'comment' : undefined)) return { status: 'kept' };     // (the marker's own work is not written over)
  let answer: ChecksAnswer;
  try {
    answer = (await controller.control('checks', tests ? { tests } : undefined)) as ChecksAnswer;
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  if (!answer || !Array.isArray(answer.checks) || answer.total === 0) return { status: 'no-tests' };
  const { gained, possible } = score(answer.checks);
  if (!options.commentsOnly && fields.mark && fields.maxMark !== null) adapter.setMark(fields, String(suggestedMark(gained, possible, fields.maxMark)));
  const from: TestsSource = tests ? 'supplied' : 'template';
  if (fields.comment) adapter.setComment(fields, commentHtml(answer, from));
  return { status: 'marked', passed: answer.passed, total: answer.total, from };
}

/** Tests every answer being marked (in `grade` mode) on the page, a few at a time, in the order they are on the page. */
export async function testAllAnswers(controllers: readonly WidgetController[], doc: Document, options: RunOptions = {}): Promise<Outcome[]> {
  const marking = [...new Set(controllers)].filter((c) => c.getConfig().runMode === 'grade');      // (each answer once)
  const outcomes: Outcome[] = new Array(marking.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < marking.length) {
      const at = next++;
      outcomes[at] = await testAnswer(marking[at], doc, { replace: options.replace, commentsOnly: options.commentsOnly, adapter: options.adapter });
      options.onProgress?.(++done, marking.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, marking.length)) }, worker));
  return outcomes;
}

/** What happened, in a sentence for the marker. */
export function summary(outcomes: readonly Outcome[]): string {
  const count = (status: Outcome['status']) => outcomes.filter((o) => o.status === status).length;
  const marked = count('marked');
  const parts = [`Tests run on ${outcomes.length} ${outcomes.length === 1 ? 'answer' : 'answers'}: ${marked} filled in (not saved: check them, then save).`];
  const template = outcomes.filter((o) => o.status === 'marked' && o.from === 'template').length;
  if (template) parts.push(`${template} marked from the question's own tests only: no author's tests were found in the grader information.`);
  if (count('missing-tests')) parts.push(`${count('missing-tests')} not marked: the question says its tests are in the grader information, and none were found there (check the question's Information for graders).`);
  if (count('kept')) parts.push(`${count('kept')} already had a mark or comment: not changed (tick "Replace what is there" to write over them).`);
  if (count('no-tests')) parts.push(`${count('no-tests')} had no tests.`);
  if (count('no-fields')) parts.push(`${count('no-fields')} had no mark or comment box on this page.`);
  const failed = outcomes.filter((o): o is { status: 'failed'; reason: string } => o.status === 'failed');
  if (failed.length) parts.push(`${failed.length} could not be run (${failed[0].reason}${failed.length > 1 ? ', ...' : ''}).`);
  return parts.join(' ');
}

/** What happened to one answer, in a sentence for the marker (the summary above is for a page of them). */
export function outcomeText(outcome: Outcome, commentsOnly = false): string {
  switch (outcome.status) {
    case 'marked': {
      const where = commentsOnly ? 'comment' : 'mark and comment';
      const from = outcome.from === 'template' ? " Marked from the question's own tests only: no author's tests were found in the grader information." : '';
      return `${outcome.passed} of ${outcome.total} passed: ${where} filled in (not saved: check, then save).${from}`;
    }
    case 'no-tests': return 'This answer has no tests.';
    case 'kept': return `Already has a ${commentsOnly ? 'comment' : 'mark or comment'}: not changed (tick "Replace what is there" to write over it).`;
    case 'missing-tests': return "Not marked: the question says its tests are in the grader information, and none were found there.";
    case 'no-fields': return 'This page has no mark or comment box for this answer.';
    case 'failed': return `Could not be run (${outcome.reason}).`;
  }
}
