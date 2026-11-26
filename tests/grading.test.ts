import { describe, it, expect, beforeEach } from 'vitest';
import { commentHtml, fieldPrefix, gradingFields, pointsOf, score, suggestedMark, writeComment } from '../src/core/grading.ts';
import { summary, testAllAnswers, testAnswer } from '../src/core/grading-runner.ts';
import { ensureGradingToolbar } from '../src/core/grading-toolbar.ts';
import type { WidgetController } from '../src/core/widget-controller.ts';

/** One answer of Moodle's manual grading form, as question/behaviour/rendererbase.php writes it. */
const answerHtml = (usage: number, slot: number, max = 10) => `
  <div class="que essay" id="question-${usage}-${slot}">
    <div class="formulation"><div class="lms-widget-container" id="w${usage}"></div><textarea name="q${usage}:${slot}_answer" readonly></textarea></div>
    <fieldset><textarea id="q${usage}:${slot}_-comment_id" name="q${usage}:${slot}_-comment"></textarea>
      <input type="text" name="q${usage}:${slot}_-mark" id="q${usage}:${slot}_-mark">
      <input type="hidden" name="q${usage}:${slot}_-maxmark" value="${max}"></fieldset>
  </div>`;

const fake = (usage: number, slot: number, answer: unknown, mode = 'grade'): WidgetController => ({
  getConfig: () => ({ runMode: mode, isReadOnly: false }),
  getFieldName: () => `q${usage}:${slot}_answer`,
  getMountPoint: () => document.getElementById(`w${usage}`)!,
  control: async (op: string) => { if (op !== 'checks') throw new Error('unexpected ' + op); if (answer instanceof Error) throw answer; return answer; },
}) as unknown as WidgetController;

const CHECKS = { checks: [{ id: 'a', name: 'doubles four', passed: true, message: '' }, { id: 'b', name: 'zero <stays> zero', passed: false, message: 'double(0) should be 0' }], passed: 1, total: 2 };

beforeEach(() => { document.body.innerHTML = ''; delete (window as any).tinymce; });

describe('the rules', () => {
  it('finds the prefix of an answer\'s fields from its name, and nothing from a name Moodle did not make', () => {
    expect(fieldPrefix('q12:3_answer')).toBe('q12:3_');
    expect(fieldPrefix('response_box')).toBeNull();
    expect(fieldPrefix(null)).toBeNull();
  });

  it('suggests the share that passed of the maximum, to two places', () => {
    expect(suggestedMark(1, 2, 10)).toBe(5);
    expect(suggestedMark(2, 3, 1)).toBe(0.67);
    expect(suggestedMark(0, 0, 10)).toBe(0);
  });

  it('adds up the points of the checks passed and of them all; a check that does not say is worth 1', () => {
    expect(pointsOf({})).toBe(1);
    expect(pointsOf({ points: 0 })).toBe(0);
    expect(pointsOf({ points: -2 })).toBe(1);
    expect(score([{ id: 'a', name: 'a', passed: true, message: '', points: 3 }, { id: 'b', name: 'b', passed: false, message: '' }])).toEqual({ gained: 3, possible: 4 });
    expect(score([])).toEqual({ gained: 0, possible: 0 });
  });

  it('writes a comment that says it was suggested, each check, and the reason for one that failed, escaped', () => {
    const html = commentHtml(CHECKS);
    expect(html).toContain('Suggested from the tests</strong>: 1 of 2 passed (1 of 2 points).');
    expect(html).toContain('✔ doubles four (1 point)</li>');
    expect(html).toContain('✘ zero &lt;stays&gt; zero (1 point): <code>double(0) should be 0</code>');
  });

  it('finds the mark, maximum and comment of an answer, and only that answer\'s', () => {
    document.body.innerHTML = answerHtml(1, 1, 10) + answerHtml(2, 1, 5);
    const f = gradingFields(document, 'q2:1_');
    expect(f.mark?.name).toBe('q2:1_-mark');
    expect(f.maxMark).toBe(5);
    expect(f.comment?.id).toBe('q2:1_-comment_id');
  });

  it('writes a comment through TinyMCE when it is there, Atto\'s area when that is, and the textarea always', () => {
    document.body.innerHTML = answerHtml(1, 1);
    const comment = document.querySelector('textarea[name="q1:1_-comment"]') as HTMLTextAreaElement;
    let saved = '';
    (window as any).tinymce = { get: (id: string) => (id === comment.id ? { setContent: (h: string) => { saved = h; }, save: () => { comment.value = saved; } } : null) };
    writeComment(comment, '<p>hi</p>');
    expect(comment.value).toBe('<p>hi</p>');
    delete (window as any).tinymce;
    const atto = document.createElement('div');
    atto.id = `${comment.id}editable`;
    document.body.append(atto);
    writeComment(comment, '<p>there</p>');
    expect(atto.innerHTML).toBe('<p>there</p>');
    expect(comment.value).toBe('<p>there</p>');
  });
});

describe('testing the answers', () => {
  it('fills in an answer\'s mark and comment from its checks', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10);
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'marked', passed: 1, total: 2 });
    expect((document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value).toBe('5');
    expect((document.querySelector('[name="q1:1_-comment"]') as HTMLTextAreaElement).value).toContain('1 of 2 passed');
  });

  it('weighs the checks by their points', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10);
    const weighted = { checks: [{ id: 'a', name: 'easy', passed: true, message: '', points: 1 }, { id: 'b', name: 'hard', passed: false, message: 'no', points: 3 }], passed: 1, total: 2 };
    await testAnswer(fake(1, 1, weighted), document);
    expect((document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value).toBe('2.5');
    expect((document.querySelector('[name="q1:1_-comment"]') as HTMLTextAreaElement).value).toContain('1 of 2 passed (1 of 4 points)');
  });

  it('says when an answer has no tests, no fields, or could not be run, and fills in nothing then', async () => {
    document.body.innerHTML = answerHtml(1, 1);
    expect(await testAnswer(fake(1, 1, { checks: [], passed: 0, total: 0 }), document)).toEqual({ status: 'no-tests' });
    expect(await testAnswer(fake(1, 1, new Error('Python did not start.')), document)).toEqual({ status: 'failed', reason: 'Python did not start.' });
    expect(await testAnswer(fake(9, 9, CHECKS), document)).toEqual({ status: 'no-fields' });
    expect((document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value).toBe('');
  });

  it('tests only the answers being marked, a few at a time, and says what happened', async () => {
    document.body.innerHTML = answerHtml(1, 1) + answerHtml(2, 1) + answerHtml(3, 1);
    let running = 0;
    let most = 0;
    const slow = (usage: number) => ({ ...fake(usage, 1, CHECKS), control: async () => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 10)); running--; return CHECKS; } }) as unknown as WidgetController;
    const progress: string[] = [];
    const one = slow(1);
    const outcomes = await testAllAnswers([one, slow(2), one, slow(3), fake(4, 1, CHECKS, 'review')], document, { concurrency: 2, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(outcomes.map((o) => o.status)).toEqual(['marked', 'marked', 'marked']);
    expect(most).toBe(2);
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    expect(summary([...outcomes, { status: 'no-tests' }, { status: 'failed', reason: 'Python did not start.' }]))
      .toBe('Tests run on 5 answers: 3 filled in (not saved: check them, then save). 1 had no tests. 1 could not be run (Python did not start.).');
  });

  it('shows the button once, above the first answer being marked, and runs every answer\'s tests when pressed', async () => {
    document.body.innerHTML = '<form>' + answerHtml(1, 1) + answerHtml(2, 1) + '</form>';
    const controllers = [fake(1, 1, CHECKS), fake(2, 1, CHECKS)];
    const bar = ensureGradingToolbar(document, () => controllers)!;
    expect(ensureGradingToolbar(document, () => controllers)).toBe(bar);
    expect(bar.nextElementSibling?.id).toBe('question-1-1');
    bar.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(bar.querySelector('[role="status"]')!.textContent).toContain('Tests run on 2 answers: 2 filled in');
    expect((document.querySelector('[name="q2:1_-mark"]') as HTMLInputElement).value).toBe('5');
  });

  it('is not shown on a page with no answer being marked, or none whose fields are on the page', () => {
    document.body.innerHTML = answerHtml(1, 1);
    expect(ensureGradingToolbar(document, () => [fake(1, 1, CHECKS, 'review')])).toBeNull();
    expect(ensureGradingToolbar(document, () => [fake(7, 7, CHECKS)])).toBeNull();
  });
});
