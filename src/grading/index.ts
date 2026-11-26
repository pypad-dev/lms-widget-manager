/**
 * Grading: on a marker's page, one button runs every answer's tests in its widget and fills in a suggested mark and comment (nothing is saved). An extension of the manager: the entry file
 * registers it (src/index.ts), and the Moodle parts are an adapter (src/adapters/grading/moodle.ts). Set `data-lms-grading="off"` on a widget's container (or any element around it) to leave a
 * page without the button.
 */

import type { ManagerExtension } from '../core/extensions';
import { ensureGradingToolbar } from './toolbar';

export const gradingExtension: ManagerExtension = {
  name: 'grading',
  widgetReady(controller, context) {
    if (controller.getConfig().runMode !== 'grade') return;
    if (controller.getMountPoint().closest('[data-lms-grading="off"]')) return;
    ensureGradingToolbar(context.document, context.controllers);
  },
};

export { ensureGradingToolbar } from './toolbar';
export { testAnswer, testAllAnswers, summary, type Outcome } from './runner';
export { commentHtml, pointsOf, score, suggestedMark, type CheckResult, type ChecksAnswer } from './scoring';
export type { GradingAdapter, GradingFields } from './adapter';
