import { IStorageAdapter } from '../../interfaces/contracts';
import { DEFAULT_ANSWER_FORMAT, decodeAnswer, encodeAnswer, type AnswerFormat } from './answer-codecs';

/**
 * Storage adapter specifically designed for Moodle quiz/assignment textareas.
 * Manages DOM manipulation, autosave event triggers, and localStorage crash recovery.
 */
export interface MoodleTextareaAdapterOptions {
  hideTextarea?: boolean;
  /** How answers are written into the box. Reading accepts every format. Default: plain text. */
  answerFormat?: AnswerFormat;
  /** false: the Moodle answer is the only copy (nothing is written to or restored from localStorage). Default true. */
  localBackup?: boolean;
}

/**
 * Storage adapter specifically designed for Moodle quiz/assignment textareas.
 * Manages DOM manipulation, autosave event triggers, and localStorage crash recovery.
 */
export class MoodleTextareaAdapter implements IStorageAdapter {
  private textarea: HTMLTextAreaElement;
  private storageKey: string;
  private observer: MutationObserver | null = null;
  private disconnectCallbacks: Array<() => void> = [];
  private answerFormat: AnswerFormat;
  private localBackup: boolean;

  constructor(textarea: HTMLTextAreaElement, options: MoodleTextareaAdapterOptions = {}) {
    if (!textarea || textarea.tagName?.toLowerCase() !== 'textarea') {
      throw new Error('MoodleTextareaAdapter requires a valid HTMLTextAreaElement.');
    }

    this.textarea = textarea;
    this.answerFormat = options.answerFormat ?? DEFAULT_ANSWER_FORMAT;
    this.localBackup = options.localBackup !== false;
    this.storageKey = this.generateStorageKey();

    // Do not hide if explicitly disabled via options
    const shouldHide = options.hideTextarea !== false;

    if (shouldHide) {
      this.hideTextarea();
    }

    this.setupDomWatcher();
  }

  /**
   * Visually hides the Moodle textarea while preserving its presence in the form for submission.
   */
  public hideTextarea(): void {
    this.textarea.style.position = 'absolute';
    this.textarea.style.left = '-9999px';
    this.textarea.style.opacity = '0';
    this.textarea.style.pointerEvents = 'none';
    this.textarea.setAttribute('tabindex', '-1');
    this.textarea.setAttribute('aria-hidden', 'true');
  }

  /**
   * Restores the visual visibility of the Moodle textarea (for debugging and live inspection).
   */
  public showTextarea(): void {
    this.textarea.style.position = '';
    this.textarea.style.left = '';
    this.textarea.style.opacity = '';
    this.textarea.style.pointerEvents = '';
    this.textarea.removeAttribute('tabindex');
    this.textarea.removeAttribute('aria-hidden');
  }

  /**
   * Checks if the textarea is currently attached and connected to the live DOM.
   */
  public isAttached(): boolean {
    if (!this.textarea) return false;
    if (typeof this.textarea.isConnected === 'boolean') {
      return this.textarea.isConnected;
    }
    const doc = this.textarea.ownerDocument || (typeof document !== 'undefined' ? document : null);
    return Boolean(doc && doc.contains && doc.contains(this.textarea));
  }

  /**
   * Proactively monitors the DOM to detect if the target textarea is deleted.
   */
  private setupDomWatcher(): void {
    const GlobalMutationObserver =
      (this.textarea.ownerDocument && this.textarea.ownerDocument.defaultView?.MutationObserver) ||
      (typeof MutationObserver !== 'undefined' ? MutationObserver : null);

    if (!GlobalMutationObserver) return;

    this.observer = new GlobalMutationObserver(() => {
      if (!this.isAttached()) {
        this.notifyDisconnect();
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }
      }
    });

    // Observe the parent node, or fallback to the body
    const target = this.textarea.parentNode || (this.textarea.ownerDocument && this.textarea.ownerDocument.body);
    if (target) {
      this.observer.observe(target, { childList: true, subtree: true });
    }
  }

  public onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
    // If already disconnected at time of subscription:
    if (!this.isAttached()) {
      try {
        callback();
      } catch (err) {
        console.error('[MoodleTextareaAdapter] Error in disconnect callback:', err);
      }
    }
  }

  private notifyDisconnect(): void {
    if (this.disconnectCallbacks.length === 0) return;
    const callbacks = [...this.disconnectCallbacks];
    this.disconnectCallbacks = [];
    callbacks.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('[MoodleTextareaAdapter] Error in disconnect callback:', err);
      }
    });
  }

  /**
   * Generates a stable unique hash identifier for this textarea based on location and identifier.
   */
  private generateStorageKey(): string {
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'host';
    const path = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
    const nameOrId = this.textarea.name || this.textarea.id || 'unnamed-box';
    const raw = `${origin}${path}#${nameOrId}`;

    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }

    return `lms_widget_backup_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Retrieves the current content.
   * If the Moodle textarea is empty, attempts crash recovery from localStorage.
   */
  public load(): string {
    const currentValue = this.textarea.value;

    if (currentValue && currentValue.trim().length > 0) {
      return decodeAnswer(currentValue);
    }

    // Attempt crash recovery from localStorage
    try {
      if (this.localBackup && typeof window !== 'undefined' && window.localStorage) {
        const backupRaw = window.localStorage.getItem(this.storageKey);
        if (backupRaw && backupRaw.trim().length > 0) {
          let backupContent = backupRaw;
          
          // Try to parse as JSON first (new format)
          try {
            const parsed = JSON.parse(backupRaw);
            if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
              backupContent = parsed.content;
            }
          } catch {
            // Fallback to raw string if it's the old format
          }

          if (backupContent && backupContent.trim().length > 0) {
            const decodedBackup = decodeAnswer(backupContent);
            this.textarea.value = encodeAnswer(decodedBackup, this.answerFormat);
            this.dispatchChangeEvents();
            return decodedBackup;
          }
        }
      }
    } catch (e) {
      console.warn('[MoodleTextareaAdapter] Unable to access localStorage during load:', e);
    }

    return currentValue || '';
  }

  /**
   * Saves content to the Moodle textarea, triggers change/input events for Moodle autosave,
   * stores a local backup, and verifies the written value.
   * Returns false if the write was rejected or failed verification.
   */
  public save(content: string): boolean {
    if (!this.isAttached()) {
      console.error('[MoodleTextareaAdapter] Cannot save: Target textarea is detached or deleted from the DOM.');
      this.notifyDisconnect();
      return false;
    }

    if (this.isReadOnly()) {
      console.warn('[MoodleTextareaAdapter] Cannot save: Host textarea is read-only or disabled.');
      return false;
    }

    try {
      const encodedContent = encodeAnswer(content, this.answerFormat);
      this.textarea.value = encodedContent;
      this.dispatchChangeEvents();

      // Write to localStorage backup
      if (this.localBackup && typeof window !== 'undefined' && window.localStorage) {
        try {
          const payload = JSON.stringify({
            content: encodedContent,
            timestamp: Date.now(),
          });
          window.localStorage.setItem(this.storageKey, payload);
        } catch (storageErr) {
          console.warn('[MoodleTextareaAdapter] LocalStorage backup write failed:', storageErr);
        }
      }

      // Verification check: ensure textarea is still attached and actually took the value
      const verified = this.isAttached() && this.textarea.value === encodedContent;
      if (!verified) {
        console.error('[MoodleTextareaAdapter] Verification failed: textarea value does not match content or element detached.');
        this.notifyDisconnect();
      }
      return verified;
    } catch (error) {
      console.error('[MoodleTextareaAdapter] Failed to save content to textarea:', error);
      return false;
    }
  }

  /**
   * Checks if the Moodle textarea is disabled or read-only (e.g., past deadline).
   */
  public isReadOnly(): boolean {
    return (
      this.textarea.disabled ||
      this.textarea.readOnly ||
      this.textarea.getAttribute('aria-disabled') === 'true'
    );
  }

  /**
   * Returns the unique storage identifier.
   */
  public getIdentifier(): string {
    return this.storageKey;
  }

  /**
   * Dispatches input and change events so Moodle's native form trackers pick up modifications, then starts
   * the quiz autosave timer, which those events do not reach.
   */
  private dispatchChangeEvents(): void {
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    this.textarea.dispatchEvent(inputEvent);
    this.textarea.dispatchEvent(changeEvent);
    this.nudgeQuizAutosave();
  }

  /**
   * Moodle's quiz autosave only notices a change in a field that has focus, so a value written by a widget
   * never starts its timer and the answer reaches the server only when the student navigates. Starting the
   * timer here makes Moodle save it within its autosave period. It does nothing outside a quiz attempt, when
   * autosave is switched off, or on a Moodle version without this autosave.
   */
  private nudgeQuizAutosave(): void {
    try {
      const view = this.textarea.ownerDocument?.defaultView as any;
      const autosave = view?.M?.mod_quiz?.autosave;
      if (autosave && autosave.form && typeof autosave.start_save_timer_if_necessary === 'function') {
        autosave.start_save_timer_if_necessary();
      }
    } catch (err) {
      console.warn('[MoodleTextareaAdapter] Could not start the Moodle quiz autosave:', err);
    }
  }

  /**
   * Cleans up local storage backups that are older than maxAgeDays.
   */
  public static garbageCollect(maxAgeDays: number = 14): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('lms_widget_backup_')) {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.timestamp) {
              if (now - parsed.timestamp > maxAgeMs) {
                keysToRemove.push(key);
              }
            } else {
              // Old plain-text format without timestamp, clear it out if we assume it's old
              keysToRemove.push(key);
            }
          }
        } catch {
          // Unparseable (likely old plain text format), clean it up
          keysToRemove.push(key);
        }
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  }

  /**
   * Cleanup lifecycle method to unbind event listeners and prevent memory leaks.
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.disconnectCallbacks = [];
  }
}
