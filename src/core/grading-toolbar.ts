/**
 * The button a marker presses to test every answer on a grading page (src/core/grading-runner.ts). Shown once, above the first answer, when the page has an answer in a widget
 * being marked whose mark or comment box is on the page.
 */

import type { WidgetController } from './widget-controller';
import { answerPrefix, gradingFields } from './grading';
import { summary, testAllAnswers } from './grading-runner';

const TOOLBAR = 'lms-widget-grading';

export function ensureGradingToolbar(doc: Document, controllers: () => readonly WidgetController[]): HTMLElement | null {
  const existing = doc.querySelector<HTMLElement>(`[data-${TOOLBAR}]`);
  if (existing) return existing;
  const marking = controllers().filter((c) => c.getConfig().runMode === 'grade');
  const first = marking.find((c) => { const prefix = answerPrefix(c.getMountPoint(), c.getFieldName()); if (!prefix) return false; const f = gradingFields(doc, prefix); return !!(f.mark || f.comment); });
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
  replace.id = `${TOOLBAR}-replace`;
  const replaceLabel = doc.createElement('label');
  replaceLabel.htmlFor = replace.id;
  replaceLabel.textContent = ' Replace what is there';
  replaceLabel.title = 'Also fill in answers that already have a mark or comment, writing over them';
  replaceLabel.prepend(replace);
  bar.append(button, replaceLabel, status);
  button.addEventListener('click', () => {
    button.disabled = true;
    status.textContent = 'Testing...';
    void testAllAnswers(controllers(), doc, { replace: replace.checked, onProgress: (done, total) => { status.textContent = `Testing: ${done} of ${total} done...`; } })
      .then((outcomes) => { status.textContent = summary(outcomes); })
      .catch((error) => { status.textContent = `The tests could not be run: ${error instanceof Error ? error.message : String(error)}`; })
      .finally(() => { button.disabled = false; });
  });
  const answer = first.getMountPoint().closest('.que') ?? first.getMountPoint();
  answer.parentNode?.insertBefore(bar, answer);
  return bar;
}
