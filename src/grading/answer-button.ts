/**
 * A button on each answer of a grading page that tests that answer alone (src/grading/runner.ts), for when one answer was changed or has to be run again. It follows the bar's two
 * choices (src/grading/choices.ts), so an answer that already has work is not written over unless the marker has ticked *Replace what is there*.
 */

import type { WidgetController } from '../core/widget-controller';
import { moodleGradingAdapter } from '../adapters/grading/moodle';
import type { GradingAdapter } from './adapter';
import { readChoices } from './choices';
import { outcomeText, testAnswer } from './runner';

const MARK = 'data-lms-grading-answer';

export function ensureAnswerButton(controller: WidgetController, doc: Document, adapter: GradingAdapter = moodleGradingAdapter): HTMLElement | null {
  const mount = controller.getMountPoint();
  const existing = mount.parentNode?.querySelector<HTMLElement>(`[${MARK}]`);
  if (existing) return existing;
  const fields = adapter.fieldsFor(mount, controller.getFieldName(), doc);
  if (!fields || (!fields.mark && !fields.comment) || !mount.parentNode) return null;
  const bar = doc.createElement('div');
  bar.setAttribute(MARK, '');
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 6px;font:13px sans-serif';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Run tests on this answer';
  button.className = 'btn btn-secondary btn-sm';
  const status = doc.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  bar.append(button, status);
  button.addEventListener('click', () => {
    const choices = readChoices(doc);
    button.disabled = true;
    status.textContent = 'Testing...';
    void testAnswer(controller, doc, { ...choices, adapter })
      .then((outcome) => { status.textContent = outcomeText(outcome, choices.commentsOnly); })
      .catch((error) => { status.textContent = `The tests could not be run: ${error instanceof Error ? error.message : String(error)}`; })
      .finally(() => { button.disabled = false; });
  });
  mount.parentNode.insertBefore(bar, mount);
  return bar;
}
