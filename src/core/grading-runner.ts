/**
 * Runs the checks of every answer on a grading page and fills in the suggested marks and comments (src/core/grading.ts has the rules). A few answers at a time, so a page of
 * many answers does not ask the browser for many Pythons at once; the widgets also keep to a budget of their own. Nothing is saved: the marker reads and saves.
 */

import type { WidgetController } from './widget-controller';
import { answerPrefix, authorNotebookIn, commentHtml, gradingFields, hasText, score, setFieldValue, suggestedMark, writeComment, type ChecksAnswer } from './grading';

export type Outcome =
  | { status: 'marked'; passed: number; total: number }
  | { status: 'no-tests' }
  | { status: 'kept' }
  | { status: 'no-fields' }
  | { status: 'failed'; reason: string };

export interface RunOptions {
  /** How many answers are tested at once (default 2). */
  concurrency?: number;
  /** Write over a mark or comment the marker has already put in (default: leave an answer that has either as it is). */
  replace?: boolean;
  /** Told after each answer: how many are done, of how many. */
  onProgress?(done: number, total: number): void;
}

/** Tests one answer and fills in its fields. */
export async function testAnswer(controller: WidgetController, doc: Document, options: { replace?: boolean } = {}): Promise<Outcome> {
  const prefix = answerPrefix(controller.getMountPoint(), controller.getFieldName());
  const fields = prefix ? gradingFields(doc, prefix) : null;
  if (!fields || (!fields.mark && !fields.comment)) return { status: 'no-fields' };
  if (!options.replace && (hasText(fields.mark?.value) || hasText(fields.comment?.value))) return { status: 'kept' };     // (the marker's own work is not written over)
  const block = controller.getMountPoint().closest('.que');
  const tests = block ? authorNotebookIn(block) : null;          // (the author's tests, from the question's grader information, in place of any in the student's notebook)
  let answer: ChecksAnswer;
  try {
    answer = (await controller.control('checks', tests ? { tests } : undefined)) as ChecksAnswer;
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  if (!answer || !Array.isArray(answer.checks) || answer.total === 0) return { status: 'no-tests' };
  const { gained, possible } = score(answer.checks);
  if (fields.mark && fields.maxMark !== null) setFieldValue(fields.mark, String(suggestedMark(gained, possible, fields.maxMark)));
  if (fields.comment) writeComment(fields.comment, commentHtml(answer));
  return { status: 'marked', passed: answer.passed, total: answer.total };
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
      outcomes[at] = await testAnswer(marking[at], doc, { replace: options.replace });
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
  if (count('kept')) parts.push(`${count('kept')} already had a mark or comment: not changed (tick "Replace what is there" to write over them).`);
  if (count('no-tests')) parts.push(`${count('no-tests')} had no tests.`);
  if (count('no-fields')) parts.push(`${count('no-fields')} had no mark or comment box on this page.`);
  const failed = outcomes.filter((o): o is { status: 'failed'; reason: string } => o.status === 'failed');
  if (failed.length) parts.push(`${failed.length} could not be run (${failed[0].reason}${failed.length > 1 ? ', ...' : ''}).`);
  return parts.join(' ');
}
