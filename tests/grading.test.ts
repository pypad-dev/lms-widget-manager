import { describe, it, expect, beforeEach, vi } from 'vitest';
import { answerPrefix, authorNotebookIn, fieldPrefix, gradingFields, hasText, writeComment } from '../src/adapters/grading/moodle.ts';
import { commentHtml, pointsOf, score, suggestedMark } from '../src/grading/scoring.ts';
import { gradingExtension } from '../src/grading/index.ts';
import { notifyWidgetReady, registerExtension, unregisterExtension } from '../src/core/extensions.ts';
import type { GradingAdapter } from '../src/grading/adapter.ts';
import { outcomeText, summary, testAllAnswers, testAnswer } from '../src/grading/runner.ts';
import { ensureGradingToolbar } from '../src/grading/toolbar.ts';
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
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'marked', passed: 1, total: 2, from: 'template' });
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
      .toBe('Tests run on 5 answers: 3 filled in (not saved: check them, then save). 3 marked from the question\'s own tests only: no author\'s tests were found in the grader information. 1 had no tests. 1 could not be run (Python did not start.).');
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

describe('the author\'s tests, and the marker\'s own work', () => {
  const withInfo = (usage: number, info: string) => answerHtml(usage, 1).replace('<fieldset>', `<div class="graderinfo">${info}</div><fieldset>`);
  const AUTHOR = '# %% [code] {"id":"t","test":"private"}\nassert 1 == 1 <\\/script>';

  it('finds the author\'s notebook in the answer\'s own block, and not in another\'s', () => {
    document.body.innerHTML = withInfo(1, `<p>Notes</p><script type="text/x-pypad-author">\n${AUTHOR}\n</script>`) + answerHtml(2, 1);
    expect(authorNotebookIn(document.getElementById('question-1-1')!)).toBe('# %% [code] {"id":"t","test":"private"}\nassert 1 == 1 </script>');
    expect(authorNotebookIn(document.getElementById('question-2-1')!)).toBeNull();
  });

  it('gives the checks request the author\'s tests when the grader information has them, and nothing otherwise', async () => {
    document.body.innerHTML = withInfo(1, `<script type="text/x-pypad-author">\n${AUTHOR}\n</script>`) + answerHtml(2, 1);
    const asked: unknown[] = [];
    const spy = (usage: number) => { const c = fake(usage, 1, CHECKS) as unknown as { control: (op: string, args?: unknown) => Promise<unknown> }; const inner = c.control; c.control = (op, args) => { asked.push(args); return inner(op); }; return c as unknown as WidgetController; };
    await testAnswer(spy(1), document);
    await testAnswer(spy(2), document);
    expect(asked[0]).toEqual({ tests: '# %% [code] {"id":"t","test":"private"}\nassert 1 == 1 </script>' });
    expect(asked[1]).toBeUndefined();
  });

  it('leaves an answer that already has a mark or a comment as it is, unless asked to replace it', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10);
    (document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value = '7';
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'kept' });
    expect((document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value).toBe('7');
    expect(await testAnswer(fake(1, 1, CHECKS), document, { replace: true })).toMatchObject({ status: 'marked' });
    expect((document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value).toBe('5');
    document.body.innerHTML = answerHtml(1, 1, 10);
    (document.querySelector('[name="q1:1_-comment"]') as HTMLTextAreaElement).value = '<p>Good start</p>';
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'kept' });
  });

  it('counts an empty editor as empty', () => {
    expect(hasText('')).toBe(false);
    expect(hasText('<p><br></p>')).toBe(false);
    expect(hasText('<p>&nbsp;</p>')).toBe(false);
    expect(hasText('<p>ok</p>')).toBe(true);
    expect(hasText('0')).toBe(true);
  });
});

describe('finding an answer\'s fields on the real marking page, where the answer\'s textarea has no name', () => {
  const nameless = (usage: number, slot: number, answer: unknown): WidgetController => ({ ...(fake(usage, slot, answer) as object), getFieldName: () => null }) as unknown as WidgetController;

  it('takes the prefix from the fields in the answer\'s own block, then from the textarea\'s name, then from the block\'s id', () => {
    document.body.innerHTML = answerHtml(40, 1);
    const mount = document.getElementById('w40')!;
    expect(answerPrefix(mount, null)).toBe('q40:1_');
    expect(answerPrefix(mount, 'q99:9_answer')).toBe('q40:1_');                       // (the block says which: the name could be another answer's)
    document.body.innerHTML = '<div id="w"></div>';
    expect(answerPrefix(document.getElementById('w'), 'q12:3_answer')).toBe('q12:3_');
    document.body.innerHTML = '<div class="que" id="question-7-2"><div id="w"></div></div>';
    expect(answerPrefix(document.getElementById('w'), null)).toBe('q7:2_');
    expect(answerPrefix(null, null)).toBeNull();
  });

  it('marks an answer whose textarea has no name, each answer into its own block', async () => {
    document.body.innerHTML = answerHtml(40, 1, 10) + answerHtml(41, 1, 10);
    expect(await testAnswer(nameless(41, 1, CHECKS), document)).toMatchObject({ status: 'marked' });
    expect((document.querySelector('[name="q41:1_-mark"]') as HTMLInputElement).value).toBe('5');
    expect((document.querySelector('[name="q40:1_-mark"]') as HTMLInputElement).value).toBe('');
  });
});

describe('grading is an extension, and names no LMS', () => {
  it('works through any adapter: a page that is not Moodle\'s', async () => {
    document.body.innerHTML = '<div id="w1"></div><input id="m"><textarea id="c"></textarea>';
    const fields = { mark: document.getElementById('m') as HTMLInputElement, maxMark: 4, comment: document.getElementById('c') as HTMLTextAreaElement };
    const calls: string[] = [];
    const adapter: GradingAdapter = {
      fieldsFor: () => fields, payloadFor: () => 'PAYLOAD', hasWork: () => false,
      setMark: (f, mark) => { calls.push('mark ' + mark); f.mark!.value = mark; },
      setComment: (f, html) => { calls.push('comment'); f.comment!.value = html; },
    };
    let asked: unknown;
    const controller = { ...(fake(1, 1, CHECKS) as object), control: async (_op: string, args?: unknown) => { asked = args; return CHECKS; } } as unknown as WidgetController;
    expect(await testAnswer(controller, document, { adapter })).toMatchObject({ status: 'marked' });
    expect(asked).toEqual({ tests: 'PAYLOAD' });
    expect(calls).toEqual(['mark 2', 'comment']);                                    // (1 of 2 points of 4)
  });

  it('is told when a widget is ready, builds the button on a marker\'s page only, and not where it is switched off', () => {
    const marking = (id: string, off = false) => {
      document.body.innerHTML = (off ? '<div data-lms-grading="off">' : '<div>') + answerHtml(1, 1) + '</div>';
      const c = fake(1, 1, CHECKS, id) as unknown as WidgetController;
      notifyWidgetReady(c, { document, controllers: () => [c] });
      return document.querySelectorAll('[data-lms-widget-grading]').length;
    };
    registerExtension(gradingExtension);
    registerExtension(gradingExtension);                                              // (a second registration of the same name changes nothing)
    expect(marking('grade')).toBe(1);
    expect(marking('attempt')).toBe(0);
    expect(marking('grade', true)).toBe(0);
  });

  it('an extension that fails does not stop the others', () => {
    let reached = false;
    registerExtension({ name: 'broken', widgetReady() { throw new Error('no'); } });
    registerExtension({ name: 'after', widgetReady() { reached = true; } });
    const quiet = console.error;
    console.error = () => undefined;
    try { notifyWidgetReady(fake(1, 1, CHECKS) as unknown as WidgetController, { document, controllers: () => [] }); } finally { console.error = quiet; unregisterExtension('broken'); unregisterExtension('after'); }
    expect(reached).toBe(true);
  });
});

describe('a question that says its tests are in the grader information', () => {
  const AUTHOR = '# %% [code] {"id":"t","test":"private"}\nassert True';
  /** An answer in a block, inside the wrapper the loader makes (it carries the embed block's data- attributes), with or without the author's notebook in the grader information. */
  const page = (flag: boolean, withBlock: boolean) => {
    document.body.innerHTML = `<div ${flag ? 'data-lms-grader-source="payload"' : ''}>` +
      answerHtml(1, 1, 10).replace('<fieldset>', `${withBlock ? `<div class="graderinfo"><script type="text/x-pypad-author">\n${AUTHOR}\n</script></div>` : ''}<fieldset>`) + '</div>';
  };
  const mark = () => (document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value;
  const comment = () => (document.querySelector('[name="q1:1_-comment"]') as HTMLTextAreaElement).value;

  it('refuses to mark when the tests are not there, and writes nothing', async () => {
    page(true, false);
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'missing-tests' });
    expect([mark(), comment()]).toEqual(['', '']);
  });

  it('says so even for an answer that already has work (the fault is the question\'s)', async () => {
    page(true, false);
    (document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value = '3';
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toEqual({ status: 'missing-tests' });
  });

  it('marks from the payload when it is there, and the comment says the author\'s tests', async () => {
    page(true, true);
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toMatchObject({ status: 'marked', from: 'supplied' });
    expect(comment()).toContain('Suggested from the author\'s tests');
  });

  it('marks from the question\'s own tests when the question does not say, and the comment says so', async () => {
    page(false, false);
    expect(await testAnswer(fake(1, 1, CHECKS), document)).toMatchObject({ status: 'marked', from: 'template' });
    expect(comment()).toContain('Suggested from the question\'s own tests (no author\'s tests were found in the grader information)');
  });

  it('is counted in what the marker is told', () => {
    expect(summary([{ status: 'missing-tests' }, { status: 'missing-tests' }, { status: 'marked', passed: 1, total: 1, from: 'supplied' }]))
      .toBe('Tests run on 3 answers: 1 filled in (not saved: check them, then save). 2 not marked: the question says its tests are in the grader information, and none were found there (check the question\'s Information for graders).');
  });
});

describe('comments only', () => {
  const mark = () => document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement;
  const comment = () => document.querySelector('[name="q1:1_-comment"]') as HTMLTextAreaElement;

  it('fills in the comment and leaves the mark box alone, whatever it holds', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10);
    mark().value = '7';
    expect(await testAnswer(fake(1, 1, CHECKS), document, { commentsOnly: true })).toMatchObject({ status: 'marked' });
    expect(mark().value).toBe('7');                                                 // (the marker's own mark is not work to protect here, and is not touched)
    expect(comment().value).toContain('1 of 2 passed');
  });

  it('still leaves a comment the marker has written, unless asked to replace it', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10);
    comment().value = '<p>Good start</p>';
    expect(await testAnswer(fake(1, 1, CHECKS), document, { commentsOnly: true })).toEqual({ status: 'kept' });
    expect(comment().value).toBe('<p>Good start</p>');
    expect(await testAnswer(fake(1, 1, CHECKS), document, { commentsOnly: true, replace: true })).toMatchObject({ status: 'marked' });
  });

  it('has nothing to do where the page has no comment box', async () => {
    document.body.innerHTML = answerHtml(1, 1, 10).replace(/<textarea id="q1:1_-comment_id"[^>]*><\/textarea>/, '');
    expect(await testAnswer(fake(1, 1, CHECKS), document, { commentsOnly: true })).toEqual({ status: 'no-fields' });
  });

  it('is chosen in the bar, remembered in this browser, and read by the buttons', () => {
    localStorage.clear();
    document.body.innerHTML = answerHtml(1, 1);
    const c = fake(1, 1, CHECKS, 'grade') as unknown as WidgetController;
    ensureGradingToolbar(document, () => [c]);
    const fill = document.getElementById('lms-widget-grading-fill') as HTMLSelectElement;
    expect([...fill.options].map((o) => o.textContent)).toEqual(['Marks and comments', 'Comments only']);
    expect(fill.value).toBe('marks-and-comments');
    fill.value = 'comments-only';
    fill.dispatchEvent(new Event('change'));
    document.querySelector('[data-lms-widget-grading]')!.remove();
    ensureGradingToolbar(document, () => [c]);                                       // (a page opened again)
    expect((document.getElementById('lms-widget-grading-fill') as HTMLSelectElement).value).toBe('comments-only');
    localStorage.clear();
  });
});

describe('the button on each answer', () => {
  const marking = (n: number, mode = 'grade') => {
    document.body.innerHTML = Array.from({ length: n }, (_, i) => answerHtml(i + 1, 1, 10)).join('');
    const calls: number[] = [];
    const controllers = Array.from({ length: n }, (_, i) => ({ ...(fake(i + 1, 1, CHECKS, mode) as object), control: async () => { calls.push(i + 1); return CHECKS; } }) as unknown as WidgetController);
    registerExtension(gradingExtension);
    for (const c of controllers) notifyWidgetReady(c, { document, controllers: () => controllers });
    return { calls };
  };
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-lms-grading-answer] button')];
  const statusOf = (i: number) => document.querySelectorAll('[data-lms-grading-answer] [role="status"]')[i]!.textContent;
  const markOf = (usage: number) => (document.querySelector(`[name="q${usage}:1_-mark"]`) as HTMLInputElement).value;

  it('is on each answer being marked, above its widget, once, and not on an attempt', () => {
    marking(2);
    expect(buttons().map((b) => b.textContent)).toEqual(['Run tests on this answer', 'Run tests on this answer']);
    expect(buttons()[0]!.closest('.que')!.id).toBe('question-1-1');
    expect(buttons()[1]!.closest('.que')!.id).toBe('question-2-1');
    marking(2, 'attempt');
    expect(buttons()).toHaveLength(0);
  });

  it('tests that answer alone, and says what happened', async () => {
    const { calls } = marking(3);
    buttons()[1]!.click();
    await vi.waitFor(() => expect(statusOf(1)).toContain('1 of 2 passed'));
    expect(calls).toEqual([2]);
    expect(markOf(2)).toBe('5');
    expect([markOf(1), markOf(3)]).toEqual(['', '']);
    expect(statusOf(1)).toContain('not saved');
  });

  it('follows the bar: an answer with work is kept until Replace what is there is ticked, and Comments only leaves the mark', async () => {
    const { calls } = marking(1);
    (document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value = '9';
    buttons()[0]!.click();
    await vi.waitFor(() => expect(statusOf(0)).toContain('Already has a mark or comment'));
    expect(calls).toEqual([]);
    (document.getElementById('lms-widget-grading-replace') as HTMLInputElement).checked = true;
    buttons()[0]!.click();
    await vi.waitFor(() => expect(statusOf(0)).toContain('1 of 2 passed'));
    expect(markOf(1)).toBe('5');
    const fill = document.getElementById('lms-widget-grading-fill') as HTMLSelectElement;
    fill.value = 'comments-only';
    (document.querySelector('[name="q1:1_-mark"]') as HTMLInputElement).value = '9';
    buttons()[0]!.click();
    await vi.waitFor(() => expect(statusOf(0)).toContain('comment filled in'));
    expect(markOf(1)).toBe('9');
  });

  it('says in words what became of an answer', () => {
    expect(outcomeText({ status: 'marked', passed: 1, total: 2, from: 'supplied' })).toBe('1 of 2 passed: mark and comment filled in (not saved: check, then save).');
    expect(outcomeText({ status: 'marked', passed: 1, total: 2, from: 'template' })).toContain("question's own tests only");
    expect(outcomeText({ status: 'kept' }, true)).toContain('Already has a comment');
    expect(outcomeText({ status: 'no-tests' })).toBe('This answer has no tests.');
    expect(outcomeText({ status: 'failed', reason: 'Python did not start.' })).toBe('Could not be run (Python did not start.).');
    expect(outcomeText({ status: 'missing-tests' })).toContain('none were found there');
  });
});
