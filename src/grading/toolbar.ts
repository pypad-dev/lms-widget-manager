/**
 * The bar a marker uses to test every answer on a grading page (src/grading/runner.ts): the button, and two choices (what to fill in; whether to write over what is there). Shown once,
 * above the first answer, when the page has an answer in a widget being marked whose mark or comment box is on the page.
 */

import type { WidgetController } from '../core/widget-controller';
import { moodleGradingAdapter } from '../adapters/grading/moodle';
import type { GradingAdapter } from './adapter';
import { FILL_ID, REPLACE_ID, readChoices, storeFill, storedFill, type Fill } from './choices';
import { summary, testAllAnswers } from './runner';

const TOOLBAR = 'lms-widget-grading';

export function ensureGradingToolbar(doc: Document, controllers: () => readonly WidgetController[], adapter: GradingAdapter = moodleGradingAdapter): HTMLElement | null {
  const existing = doc.querySelector<HTMLElement>(`[data-${TOOLBAR}]`);
  if (existing) return existing;
  const marking = controllers().filter((c) => c.getConfig().runMode === 'grade');
  const first = marking.find((c) => { const f = adapter.fieldsFor(c.getMountPoint(), c.getFieldName(), doc); return !!(f && (f.mark || f.comment)); });
  if (!first) return null;
  const bar = doc.createElement('div');
  bar.setAttribute(`data-${TOOLBAR}`, '');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Tests');
  bar.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;font:14px sans-serif';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Run tests on all answers';
  button.className = 'btn btn-secondary';
  const status = doc.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const replace = doc.createElement('input');
  replace.type = 'checkbox';
  replace.id = REPLACE_ID;
  const replaceLabel = doc.createElement('label');
  replaceLabel.htmlFor = replace.id;
  replaceLabel.textContent = ' Replace what is there';
  replaceLabel.title = 'Also fill in answers that already have a mark or comment, writing over them';
  replaceLabel.prepend(replace);
  const fill = doc.createElement('select');
  fill.id = FILL_ID;
  for (const [value, label] of [['marks-and-comments', 'Marks and comments'], ['comments-only', 'Comments only']] as const) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    fill.append(option);
  }
  fill.value = storedFill();
  fill.title = 'What to fill in: the mark and the comment, or only the comment (your own mark stands)';
  fill.addEventListener('change', () => storeFill(fill.value as Fill));
  const fillLabel = doc.createElement('label');
  fillLabel.htmlFor = FILL_ID;
  fillLabel.textContent = 'Fill in ';
  fillLabel.append(fill);
  bar.append(button, fillLabel, replaceLabel, status);
  button.addEventListener('click', () => {
    button.disabled = true;
    status.textContent = 'Testing...';
    void testAllAnswers(controllers(), doc, { ...readChoices(doc), adapter, onProgress: (done, total) => { status.textContent = `Testing: ${done} of ${total} done...`; } })
      .then((outcomes) => { status.textContent = summary(outcomes); })
      .catch((error) => { status.textContent = `The tests could not be run: ${error instanceof Error ? error.message : String(error)}`; })
      .finally(() => { button.disabled = false; });
  });
  const answer = first.getMountPoint().closest('.que') ?? first.getMountPoint();
  answer.parentNode?.insertBefore(bar, answer);
  return bar;
}
