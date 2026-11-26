/**
 * Extensions: optional features that attach to the manager without being part of its core (grading is the first: src/grading). The core knows nothing of what an extension does. It
 * offers one hook, called when a widget has been set up, and an extension is in the bundle only if the entry file registers it (src/index.ts: take its line out, and it is gone).
 */

import type { WidgetController } from './widget-controller';

/** What the core gives an extension about the page. */
export interface ManagerContext {
  document: Document;
  /** Every widget set up on the page so far. */
  controllers(): readonly WidgetController[];
}

export interface ManagerExtension {
  name: string;
  /** A widget has been set up (its messenger is ready). */
  widgetReady?(controller: WidgetController, context: ManagerContext): void;
}

const extensions: ManagerExtension[] = [];

/** Adds an extension (once: a second one of the same name is ignored). */
export function registerExtension(extension: ManagerExtension): void {
  if (!extensions.some((e) => e.name === extension.name)) extensions.push(extension);
}

/** Takes an extension away again (for a page that no longer wants it, and for tests). */
export function unregisterExtension(name: string): void {
  const at = extensions.findIndex((e) => e.name === name);
  if (at !== -1) extensions.splice(at, 1);
}

/** Tells the extensions a widget is ready. One that fails does not stop the others, or the widget. */
export function notifyWidgetReady(controller: WidgetController, context: ManagerContext): void {
  for (const extension of extensions) {
    try { extension.widgetReady?.(controller, context); } catch (error) { console.error(`[LMS Widget Manager] The ${extension.name} extension failed:`, error); }
  }
}
