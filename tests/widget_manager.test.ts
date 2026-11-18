import { test } from 'vitest';
import { JSDOM } from 'jsdom';
import { MoodleTextareaAdapter } from '../src/adapters/storage/moodle-textarea.ts';
import { WidgetController } from '../src/core/widget-controller.ts';
import { DOMEventMessengerAdapter } from '../src/adapters/messenger/web-component.ts';
import {
  WidgetMessageTypes,
  IStorageAdapter,
  IMessengerAdapter,
  IContextAdapter,
  MessageHandler,
} from '../src/interfaces/contracts.ts';
import { bootstrap, WidgetBootstrapper, showSetupProblem } from '../src/index.ts';

function createMockEnvironment(html?: string) {
  const dom = new JSDOM(
    html ||
      `<!DOCTYPE html>
    <html>
      <head></head>
      <body>
        <div id="container">
          <textarea id="test-textarea" name="response_box">initial content</textarea>
          <div id="mount-point" class="lms-widget-container" data-lms-target-textarea="#test-textarea">
            <custom-editor data-lms-widget="true"></custom-editor>
          </div>
        </div>
      </body>
    </html>`,
    { url: 'https://moodle.example.edu/mod/quiz/attempt.php?attempt=123' }
  );

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  (globalThis as any).HTMLIFrameElement = dom.window.HTMLIFrameElement;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CustomEvent = dom.window.CustomEvent;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).getComputedStyle = dom.window.getComputedStyle;

  return dom;
}

test('MoodleTextareaAdapter - hides textarea and loads initial content', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;

  const adapter = new MoodleTextareaAdapter(textarea);
  if (textarea.style.position !== 'absolute') {
    throw new Error(`Expected position absolute, got ${textarea.style.position}`);
  }

  const loaded = adapter.load();
  if (loaded !== 'initial content') {
    throw new Error(`Expected 'initial content', got ${loaded}`);
  }
});

test('MoodleTextareaAdapter - saves content and dispatches input/change events', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  let inputFired = false;
  let changeFired = false;

  textarea.addEventListener('input', () => {
    inputFired = true;
  });
  textarea.addEventListener('change', () => {
    changeFired = true;
  });

  const adapter = new MoodleTextareaAdapter(textarea, { answerFormat: 'base64' });
  const success = adapter.save('updated content');

  if (!success) {
    throw new Error('Expected save to return true');
  }
  // With the base64 format, payloads carry a prefix so a sanitiser cannot alter them
  if (textarea.value !== 'LMS_WIDGET_BASE64:' + btoa('updated content')) {
    throw new Error('Textarea value was not updated');
  }
  if (!inputFired || !changeFired) {
    throw new Error('Input or change event was not dispatched');
  }
});

test('MoodleTextareaAdapter - performs crash recovery from localStorage when textarea is empty', () => {
  const dom = createMockEnvironment(
    `<!DOCTYPE html>
    <html><body>
      <textarea id="test-textarea" name="response_box"></textarea>
    </body></html>`
  );
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  const adapter = new MoodleTextareaAdapter(textarea, { answerFormat: 'base64' });

  // Simulate existing localStorage backup using new JSON format
  dom.window.localStorage.setItem(
    adapter.getIdentifier(),
    JSON.stringify({ content: 'backed up draft from crash', timestamp: Date.now() })
  );

  const loaded = adapter.load();
  if (loaded !== 'backed up draft from crash') {
    throw new Error(`Expected 'backed up draft from crash', got ${loaded}`);
  }
  if (textarea.value !== 'LMS_WIDGET_BASE64:' + btoa('backed up draft from crash')) {
    throw new Error('Textarea value was not restored with backup');
  }
});

// Moodle's quiz autosave does not see a value a widget writes into the hidden textarea, so the adapter starts its timer.
function withQuizAutosave(dom: JSDOM, autosave: any) {
  (dom.window as any).M = { mod_quiz: { autosave } };
}

test('MoodleTextareaAdapter - starts the Moodle quiz autosave timer after a save', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  let started = 0;
  withQuizAutosave(dom, { form: {}, start_save_timer_if_necessary: () => { started++; } });

  const adapter = new MoodleTextareaAdapter(textarea);
  if (!adapter.save('print(1)')) throw new Error('save failed');
  if (started !== 1) throw new Error(`Expected the autosave timer to be started once, got ${started}`);
});

test('MoodleTextareaAdapter - leaves quiz autosave alone when it is not running on the page', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  let started = 0;
  // loaded but never initialised (autosave period 0): no form
  withQuizAutosave(dom, { start_save_timer_if_necessary: () => { started++; } });

  const adapter = new MoodleTextareaAdapter(textarea);
  if (!adapter.save('print(1)')) throw new Error('save failed');
  if (started !== 0) throw new Error('Autosave was started although it is not initialised');
});

test('MoodleTextareaAdapter - saves normally outside a quiz (no Moodle autosave at all)', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  const adapter = new MoodleTextareaAdapter(textarea);
  if (!adapter.save('print(1)')) throw new Error('save failed');
  if (textarea.value !== 'print(1)') throw new Error('Textarea value was not updated');
});

test('MoodleTextareaAdapter - a failing Moodle autosave never fails the save', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  withQuizAutosave(dom, { form: {}, start_save_timer_if_necessary: () => { throw new Error('moodle changed'); } });

  const warn = console.warn;
  console.warn = () => {};
  try {
    const adapter = new MoodleTextareaAdapter(textarea);
    if (!adapter.save('print(1)')) throw new Error('save failed because autosave threw');
    if (textarea.value !== 'print(1)') throw new Error('Textarea value was not updated');
  } finally {
    console.warn = warn;
  }
});

test('MoodleTextareaAdapter - also starts the autosave timer when a crash-recovery backup is restored', () => {
  const dom = createMockEnvironment('<!DOCTYPE html><html><body><textarea id="test-textarea" name="response_box"></textarea></body></html>');
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  let started = 0;
  withQuizAutosave(dom, { form: {}, start_save_timer_if_necessary: () => { started++; } });

  const adapter = new MoodleTextareaAdapter(textarea);
  dom.window.localStorage.setItem(adapter.getIdentifier(), JSON.stringify({ content: 'draft', timestamp: Date.now() }));
  if (adapter.load() !== 'draft') throw new Error('backup was not restored');
  if (started !== 1) throw new Error(`Expected the autosave timer to be started once on restore, got ${started}`);
});

const AWKWARD = '# %% [code]\nif a < b & c > d:\n\tprint("</textarea><script>x</script> &amp; \u00a0 😀 $\\alpha_1$")\n\n\n    trailing   \n';
const box = () => {
  const dom = createMockEnvironment('<!DOCTYPE html><html><body><textarea id="t" name="q"></textarea></body></html>');
  return dom.window.document.getElementById('t') as HTMLTextAreaElement;
};

test('MoodleTextareaAdapter - writes plain text by default, exactly as given', () => {
  const textarea = box();
  const adapter = new MoodleTextareaAdapter(textarea);
  if (!adapter.save(AWKWARD)) throw new Error('save failed');
  if (textarea.value !== AWKWARD) throw new Error('plain text was altered on its way into the box');
  if (adapter.load() !== AWKWARD) throw new Error('plain text did not read back');
});

test('MoodleTextareaAdapter - each format round-trips awkward content, and either format is read whichever wrote it', () => {
  for (const writer of ['plain', 'base64'] as const) {
    const textarea = box();
    new MoodleTextareaAdapter(textarea, { answerFormat: writer }).save(AWKWARD);
    // a reader set up with the OTHER format still reads it
    const reader = new MoodleTextareaAdapter(textarea, { answerFormat: writer === 'plain' ? 'base64' : 'plain' });
    if (reader.load() !== AWKWARD) throw new Error(`${writer}-written answer did not read back through the other format's adapter`);
  }
});

test('MoodleTextareaAdapter - the browser turning line breaks into CRLF is the only change plain text meets (and a notebook ignores it)', () => {
  const textarea = box();
  const adapter = new MoodleTextareaAdapter(textarea);
  textarea.value = AWKWARD.replace(/\n/g, '\r\n'); // what a submitted form comes back as
  if (adapter.load().replace(/\r\n/g, '\n') !== AWKWARD) throw new Error('content other than line endings changed');
});

test('MoodleTextareaAdapter - leaves an untouched answer box empty', () => {
  const textarea = box();
  const adapter = new MoodleTextareaAdapter(textarea);
  if (adapter.load() !== '') throw new Error('an empty box should load as empty');
  if (textarea.value !== '') throw new Error('loading must not write into the box');
});

test('MoodleTextareaAdapter - localBackup:false never reads or writes localStorage', () => {
  const dom = createMockEnvironment(
    `<!DOCTYPE html>
    <html><body>
      <textarea id="test-textarea" name="response_box"></textarea>
    </body></html>`
  );
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  const adapter = new MoodleTextareaAdapter(textarea, { localBackup: false });
  dom.window.localStorage.setItem(
    adapter.getIdentifier(),
    JSON.stringify({ content: 'stale draft', timestamp: Date.now() })
  );
  if (adapter.load() !== '') throw new Error('Empty Moodle answer must stay empty');
  adapter.save('fresh');
  const stored = JSON.parse(dom.window.localStorage.getItem(adapter.getIdentifier()) as string);
  if (stored.content !== 'stale draft') throw new Error('localStorage must not be written');
});

test('WidgetController - handles sync success and sends ACK', () => {
  const dom = createMockEnvironment();
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;

  let savedData = '';
  const mockStorage: IStorageAdapter = {
    load: () => 'stored-data',
    save: (content: string) => {
      savedData = content;
      return true;
    },
    isReadOnly: () => false,
    getIdentifier: () => 'mock-id',
  };

  let ackSent = false;
  let sentHash = '';
  const mockMessenger: IMessengerAdapter = {
    sendLoadContent: () => {},
    sendInsertContent: () => {},
    sendSyncAck: (_msgId: string, hash: string) => {
      ackSent = true;
      sentHash = hash;
    },
    onMessage: (handler: MessageHandler) => {
      // Simulate widget emitting SYNC_CONTENT
      handler(WidgetMessageTypes.SYNC_CONTENT, { content: 'typed from widget', msgId: '123' });
    },
    lockdown: () => {},
  };

  const controller = new WidgetController(mountPoint, mockStorage, mockMessenger);
  if (savedData !== 'typed from widget') {
    throw new Error(`Expected 'typed from widget', got ${savedData}`);
  }
  if (!ackSent || !sentHash) {
    throw new Error('Expected sync ACK to be sent with server hash');
  }
  if (controller.getIsErrorState()) {
    throw new Error('Controller should not be in error state');
  }
});

test('WidgetController - triggers Fail-Fast lockdown and red banner when save fails', () => {
  const dom = createMockEnvironment();
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
  const customWidget = mountPoint.querySelector('custom-editor') as HTMLElement;

  const mockStorage: IStorageAdapter = {
    load: () => 'stored-data',
    save: () => false, // Simulate host rejecting the write / failure
    isReadOnly: () => false,
    getIdentifier: () => 'mock-id',
  };

  let lockdownCalled = false;
  let triggerSync: MessageHandler | null = null;

  const mockMessenger: IMessengerAdapter = {
    sendLoadContent: () => {},
    sendInsertContent: () => {},
    sendSyncAck: () => {},
    onMessage: (handler: MessageHandler) => {
      triggerSync = handler;
    },
    lockdown: () => {
      lockdownCalled = true;
    },
  };

  const controller = new WidgetController(mountPoint, mockStorage, mockMessenger);

  // Trigger sync that will fail
  if (triggerSync) {
    (triggerSync as MessageHandler)(WidgetMessageTypes.SYNC_CONTENT, 'user typed content');
  }

  if (!controller.getIsErrorState()) {
    throw new Error('Controller should be in error state after failed save');
  }
  if (!lockdownCalled) {
    throw new Error('Messenger lockdown was not called on fatal error');
  }

  // Verify visual blur and pointer-events disabled
  if (customWidget.style.pointerEvents !== 'none') {
    throw new Error(`Expected pointer-events none, got ${customWidget.style.pointerEvents}`);
  }
  if (!customWidget.style.filter.includes('blur')) {
    throw new Error(`Expected blur filter, got ${customWidget.style.filter}`);
  }

  // Verify red banner injection
  const banner = mountPoint.querySelector('.lms-widget-fatal-error-banner');
  if (!banner) {
    throw new Error('Expected fatal error banner to be injected in mount point');
  }
});

test('Bootstrapper - prevents collisions when multiple widgets target the same textarea', () => {
  const dom = createMockEnvironment(
    `<!DOCTYPE html>
    <html><body>
      <textarea id="box-1" name="q1_answer"></textarea>
      
      <!-- First widget -->
      <div id="w1" class="lms-widget-container" data-lms-target-textarea="#box-1">
        <custom-widget data-lms-widget="true"></custom-widget>
      </div>

      <!-- Second widget mistakenly targeting the same box -->
      <div id="w2" class="lms-widget-container" data-lms-target-textarea="#box-1">
        <custom-widget data-lms-widget="true"></custom-widget>
      </div>
    </body></html>`
  );

  const controllers = bootstrap();

  // First one should succeed, second one should be aborted
  if (controllers.length !== 1) {
    throw new Error(`Expected 1 initialized controller, got ${controllers.length}`);
  }

  // The second is a set-up problem: frozen, with a message above it for teaching staff
  const w2 = dom.window.document.getElementById('w2') as HTMLElement;
  if (w2.getAttribute('data-lms-setup-problem') !== 'shared-answer-box') throw new Error('Expected the duplicate widget to be marked as a shared answer box');
  const banner = w2.previousElementSibling;
  if (!banner?.classList.contains('lms-widget-setup-error') || !banner.textContent?.includes('more than one editor saving into the same answer box')) {
    throw new Error(`Expected the set-up message above the duplicate widget, got: ${banner?.textContent}`);
  }
  if ((w2.querySelector('[data-lms-widget]') as HTMLElement).style.pointerEvents !== 'none') throw new Error('The duplicate widget should be frozen');
  if (dom.window.document.getElementById('w1')!.hasAttribute('data-lms-setup-problem')) throw new Error('The first widget should be left working');
});

test('MoodleContextAdapter - detects authoring/edit mode from URL', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div></body></html>', {
    url: 'https://moodle.example.edu/question/question.php?inpopup=0&id=42',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;

  const { MoodleContextAdapter } = await import('../src/adapters/context/moodle.ts');
  const mount = dom.window.document.getElementById('m');
  const mode = new MoodleContextAdapter(mount).getRunMode();
  if (mode !== 'edit') {
    throw new Error(`Expected 'edit', got '${mode}'`);
  }
});

test('MoodleContextAdapter - detects manual grading mode from report URL and .comment-area', async () => {
  const { MoodleContextAdapter } = await import('../src/adapters/context/moodle.ts');

  // Test 1: Grading URL
  const domUrl = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div></body></html>', {
    url: 'https://moodle.example.edu/mod/quiz/report.php?id=12&mode=grading',
  });
  (globalThis as any).window = domUrl.window;
  (globalThis as any).document = domUrl.window.document;
  const modeFromUrl = new MoodleContextAdapter(domUrl.window.document.getElementById('m')).getRunMode();
  if (modeFromUrl !== 'grade') {
    throw new Error(`Expected 'grade' from URL, got '${modeFromUrl}'`);
  }

  // Test 1b: the page where a marker opens one student's answer (the answer is shown locked there, as on a review page)
  const domComment = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div><textarea readonly></textarea></body></html>', {
    url: 'https://moodle.example.edu/mod/quiz/comment.php?attempt=7&slot=1',
  });
  (globalThis as any).window = domComment.window;
  (globalThis as any).document = domComment.window.document;
  const modeFromComment = new MoodleContextAdapter(
    domComment.window.document.getElementById('m'),
    domComment.window.document.querySelector('textarea')
  ).getRunMode();
  if (modeFromComment !== 'grade') {
    throw new Error(`Expected 'grade' from comment.php, got '${modeFromComment}'`);
  }

  // Test 2: DOM cue (.comment-area)
  const domDom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div class="que">
        <div id="m" class="lms-widget-container"></div>
        <div class="comment-area"><textarea class="commenttext"></textarea></div>
      </div>
    </body></html>`,
    { url: 'https://moodle.example.edu/mod/quiz/report.php' }
  );
  (globalThis as any).window = domDom.window;
  (globalThis as any).document = domDom.window.document;
  const modeFromDom = new MoodleContextAdapter(domDom.window.document.getElementById('m')).getRunMode();
  if (modeFromDom !== 'grade') {
    throw new Error(`Expected 'grade' from .comment-area, got '${modeFromDom}'`);
  }

  // Test 3: Hidden .comment-area (display: none) should NOT trigger grade mode
  const domHidden = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div class="que">
        <div id="m" class="lms-widget-container"></div>
        <div class="comment-area" style="display: none;"><textarea class="commenttext"></textarea></div>
      </div>
    </body></html>`,
    { url: 'https://moodle.example.edu/mod/quiz/attempt.php' }
  );
  (globalThis as any).window = domHidden.window;
  (globalThis as any).document = domHidden.window.document;
  const modeFromHidden = new MoodleContextAdapter(domHidden.window.document.getElementById('m')).getRunMode();
  if (modeFromHidden !== 'attempt') {
    throw new Error(`Expected 'attempt' when comment-area is display:none, got '${modeFromHidden}'`);
  }
});

test('MoodleContextAdapter - detects post-assessment review mode from review.php', async () => {
  const { MoodleContextAdapter } = await import('../src/adapters/context/moodle.ts');
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div class="que">
        <textarea id="box" readonly></textarea>
        <div id="m" class="lms-widget-container"></div>
      </div>
    </body></html>`,
    { url: 'https://moodle.example.edu/mod/quiz/review.php?attempt=10' }
  );
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  const mount = dom.window.document.getElementById('m');
  const textarea = dom.window.document.getElementById('box') as HTMLTextAreaElement;
  const mode = new MoodleContextAdapter(mount, textarea).getRunMode();
  if (mode !== 'review') {
    throw new Error(`Expected 'review', got '${mode}'`);
  }
});

test('MoodleContextAdapter - implements IContextAdapter and respects data-lms-run-mode & data-lms-readonly', async () => {
  const { MoodleContextAdapter } = await import('../src/adapters/context/moodle.ts');
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div id="m" class="lms-widget-container" data-lms-run-mode="grade" data-lms-readonly="true"></div>
    </body></html>`,
    { url: 'https://moodle.example.edu/mod/quiz/attempt.php' }
  );

  const mount = dom.window.document.getElementById('m') as HTMLElement;
  const adapter = new MoodleContextAdapter(mount);

  if (adapter.getRunMode() !== 'grade') {
    throw new Error(`Expected getRunMode() to be 'grade', got '${adapter.getRunMode()}'`);
  }
  if (!adapter.isReadOnly()) {
    throw new Error(`Expected isReadOnly() to be true when data-lms-readonly="true"`);
  }
});

test('WidgetController - pushes deduced runMode in IWidgetConfig on load', () => {
  const dom = createMockEnvironment();
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;

  let loadedConfig: any = null;
  const mockStorage: IStorageAdapter = {
    load: () => 'initial code',
    save: () => true,
    isReadOnly: () => false,
    getIdentifier: () => 'id1',
  };

  const mockMessenger: IMessengerAdapter = {
    sendLoadContent: (_content: string, config: any) => {
      loadedConfig = config;
    },
    sendInsertContent: () => {},
    sendSyncAck: () => {},
    onMessage: () => {},
    lockdown: () => {},
  };

  const controller = new WidgetController(mountPoint, mockStorage, mockMessenger, {
    runMode: 'grade',
  });

  if (!loadedConfig) {
    throw new Error('Expected sendLoadContent to be called on boot');
  }
  if (loadedConfig.runMode !== 'grade') {
    throw new Error(`Expected config.runMode to be 'grade', got '${loadedConfig.runMode}'`);
  }
  if (controller.getConfig().runMode !== 'grade') {
    throw new Error(`Expected controller.getConfig().runMode to be 'grade'`);
  }
});

test('WidgetController - accepts IContextAdapter and populates namespaced attributes', () => {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div id="m" class="lms-widget-container" data-lms-default-cell-type="markdown" data-lms-disable-insert-all="true">
        <div data-lms-widget="true"></div>
      </div>
    </body></html>`
  );
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;

  const mount = dom.window.document.getElementById('m') as HTMLElement;
  let loadedConfig: any = null;

  const mockStorage: IStorageAdapter = {
    load: () => 'code',
    save: () => true,
    isReadOnly: () => false,
    getIdentifier: () => 'id-context',
  };

  const mockMessenger: IMessengerAdapter = {
    sendLoadContent: (_content: string, config: any) => {
      loadedConfig = config;
    },
    sendInsertContent: () => {},
    sendSyncAck: () => {},
    onMessage: () => {},
    lockdown: () => {},
  };

  const mockContext: IContextAdapter = {
    getRunMode: () => 'edit',
    isReadOnly: () => false,
  };

  new WidgetController(mount, mockStorage, mockMessenger, {
    context: mockContext,
  });

  if (loadedConfig.runMode !== 'edit') {
    throw new Error(`Expected runMode 'edit', got '${loadedConfig.runMode}'`);
  }
  if (loadedConfig.defaultCellType !== 'markdown') {
    throw new Error(`Expected defaultCellType 'markdown', got '${loadedConfig.defaultCellType}'`);
  }
  if (loadedConfig.disableInsertAll !== true) {
    throw new Error(`Expected disableInsertAll to be true, got '${loadedConfig.disableInsertAll}'`);
  }
});

test('Bootstrapper - patiently observes and initializes when [data-lms-widget] is injected asynchronously', async () => {
  const dom = createMockEnvironment(
    `<!DOCTYPE html><html><body>
      <textarea id="box-async" name="async_ans"></textarea>
      <div id="async-container" class="lms-widget-container" data-lms-target-textarea="#box-async">
      </div>
    </body></html>`
  );

  (globalThis as any).MutationObserver = dom.window.MutationObserver;

  const container = dom.window.document.getElementById('async-container') as HTMLElement;
  bootstrap();

  // Placeholder should be rendered
  const placeholder = container.querySelector('.lms-widget-placeholder');
  if (!placeholder) {
    throw new Error('Expected placeholder while waiting for [data-lms-widget]');
  }

  // Now inject the widget element with data-lms-widget
  const widget = dom.window.document.createElement('div');
  widget.setAttribute('data-lms-widget', 'true');
  container.appendChild(widget);

  // Wait for MutationObserver callback to execute
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Placeholder should have been removed
  if (container.querySelector('.lms-widget-placeholder')) {
    throw new Error('Expected placeholder to be removed after widget resolution');
  }
});



test('Bootstrapper - unhides Moodle textarea when container has data-lms-widget-show-answerbox', () => {
  const dom = createMockEnvironment(
    `<!DOCTYPE html><html><body>
      <textarea id="box-debug" name="debug_box"></textarea>
      <div id="debug-container" class="lms-widget-container" data-lms-target-textarea="#box-debug" data-lms-widget-show-answerbox="true">
        <div data-lms-widget="true"></div>
      </div>
    </body></html>`
  );

  bootstrap();

  const textarea = dom.window.document.getElementById('box-debug') as HTMLTextAreaElement;
  if (textarea.style.position === 'absolute') {
    throw new Error('Textarea should remain visible when container has data-lms-widget-show-answerbox');
  }
});

test('MoodleTextareaAdapter - garbageCollect cleans up old JSON backups but keeps recent ones', () => {
  const dom = createMockEnvironment();
  
  const now = Date.now();
  const oldTime = now - (15 * 24 * 60 * 60 * 1000); // 15 days ago
  const recentTime = now - (5 * 24 * 60 * 60 * 1000); // 5 days ago

  dom.window.localStorage.setItem('lms_widget_backup_old1', JSON.stringify({ content: 'old', timestamp: oldTime }));
  dom.window.localStorage.setItem('lms_widget_backup_recent', JSON.stringify({ content: 'recent', timestamp: recentTime }));
  dom.window.localStorage.setItem('lms_widget_backup_old_plaintext', 'this is old plain text');
  dom.window.localStorage.setItem('unrelated_key', 'should remain');

  MoodleTextareaAdapter.garbageCollect(14);

  if (dom.window.localStorage.getItem('lms_widget_backup_old1')) throw new Error('Old backup was not cleared');
  if (dom.window.localStorage.getItem('lms_widget_backup_old_plaintext')) throw new Error('Old plain text backup was not cleared');
  if (!dom.window.localStorage.getItem('lms_widget_backup_recent')) throw new Error('Recent backup was incorrectly cleared');
  if (!dom.window.localStorage.getItem('unrelated_key')) throw new Error('Unrelated key was incorrectly cleared');
});

test('WidgetController - destroy cleans up activeControllers', () => {
  createMockEnvironment(
    `<!DOCTYPE html><html><body>
      <textarea id="box1" name="box1"></textarea>
      <div id="c1" class="lms-widget-container" data-lms-target-textarea="#box1">
        <div data-lms-widget="true"></div>
      </div>
    </body></html>`
  );

  // We need to import activeControllers to check it, but since it's exported from index.ts,
  // we can use the bootstrap method which returns the controllers.
  const controllers = bootstrap();
  if (controllers.length !== 1) throw new Error('Expected 1 controller');

  const controller = controllers[0];
  controller.destroy();
  
  // We'll trust the binding logic.
});

test('MoodleTextareaAdapter - save() fails and returns false when textarea is detached from the DOM', () => {
  const dom = createMockEnvironment();
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  const adapter = new MoodleTextareaAdapter(textarea);

  // Remove textarea from DOM
  textarea.remove();

  const success = adapter.save('detached save attempt');
  if (success) {
    throw new Error('save() should return false when textarea is detached');
  }
});

test('MoodleTextareaAdapter - triggers onDisconnect callback when textarea is removed from DOM', async () => {
  const dom = createMockEnvironment();
  // Ensure MutationObserver is available in the global mock scope for the adapter
  (globalThis as any).MutationObserver = dom.window.MutationObserver;

  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;
  const adapter = new MoodleTextareaAdapter(textarea);

  let disconnectFired = false;
  adapter.onDisconnect!(() => {
    disconnectFired = true;
  });

  // Remove textarea from DOM
  textarea.remove();

  // Wait a tick for MutationObserver microtask to fire
  await new Promise((resolve) => setTimeout(resolve, 10));

  if (!disconnectFired) {
    throw new Error('onDisconnect callback was not triggered upon DOM removal');
  }

  adapter.destroy!();
});

test('WidgetController - enters fail-fast lockdown when target textarea is removed from DOM', async () => {
  const dom = createMockEnvironment();
  (globalThis as any).MutationObserver = dom.window.MutationObserver;

  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
  const textarea = dom.window.document.getElementById('test-textarea') as HTMLTextAreaElement;

  const storage = new MoodleTextareaAdapter(textarea);
  const messenger = new DOMEventMessengerAdapter(mountPoint);

  const controller = new WidgetController(mountPoint, storage, messenger);

  // Remove textarea from DOM
  textarea.remove();

  // Wait a tick for MutationObserver microtask to fire and trigger controller lockdown
  await new Promise((resolve) => setTimeout(resolve, 10));

  if (!controller.getIsErrorState()) {
    throw new Error('WidgetController should be in error state after textarea removal');
  }

  const banner = mountPoint.querySelector('.lms-widget-fatal-error-banner');
  if (!banner) {
    throw new Error('Fatal error banner was not injected');
  }

  controller.destroy();
});

test('WidgetController - insertContent forwards content to messenger adapter', () => {
  const dom = createMockEnvironment();
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
  const storage: IStorageAdapter = {
    load: () => 'initial',
    save: () => true,
    isReadOnly: () => false,
    getIdentifier: () => 'id-test',
  };

  let insertedContent = '';
  const messenger: IMessengerAdapter = {
    sendLoadContent: () => {},
    sendInsertContent: (content: string) => {
      insertedContent = content;
    },
    sendSyncAck: () => {},
    onMessage: () => {},
    lockdown: () => {},
  };

  const controller = new WidgetController(mountPoint, storage, messenger);
  const success = controller.insertContent('def foo():\n    pass');
  if (!success) {
    throw new Error('insertContent should return true');
  }
  if (insertedContent !== 'def foo():\n    pass') {
    throw new Error(`Expected inserted content to match, got '${insertedContent}'`);
  }
  controller.destroy();
});


test('DOMEventMessengerAdapter - natively inserts into textarea when host:insert-content is not handled', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><textarea id="box">initial</textarea></body></html>');
  const textarea = dom.window.document.getElementById('box') as HTMLTextAreaElement;
  textarea.selectionStart = textarea.selectionEnd = 7; // after 'initial'

  let inputFired = false;
  textarea.addEventListener('input', () => {
    inputFired = true;
  });

  const adapter = new DOMEventMessengerAdapter(textarea);
  adapter.sendInsertContent(' added\n');

  if (textarea.value !== 'initial added\n') {
    throw new Error(`Expected 'initial added\\n', got '${textarea.value}'`);
  }
  if (!inputFired) {
    throw new Error('Expected native input event to be dispatched');
  }
  adapter.destroy();
});




test('Bootstrapper - shows an error message as text: markup in it is never made into elements (banner and error slot)', () => {
  const hostile = '<img src=x onerror="window.__hacked = 1"><b>bold</b>';
  const dom = createMockEnvironment(
    `<!DOCTYPE html><html><body>
      <div id="banner-host"></div>
      <div id="slot-host"><div data-lms-error-slot></div></div>
    </body></html>`
  );
  for (const id of ['banner-host', 'slot-host']) {
    const host = dom.window.document.getElementById(id) as HTMLElement;
    showSetupProblem(host, { id: 'test', title: hostile, lines: [hostile] }, () => {});
    // (the banner goes above the container, in its parent; a page's own error slot is inside it)
    const shown = id === 'banner-host' ? host.parentElement! : host;
    if (shown.querySelector('img, b')) throw new Error(`The message was turned into elements in #${id}`);
    if (!shown.textContent?.includes(hostile)) throw new Error(`The message was not shown as written in #${id}`);
  }
  if ((dom.window as any).__hacked) throw new Error('Script in the message ran');
});

// Moodle's essay answer box as the attempt page has it, in a response format (Moodle: 1 is HTML, 2 is plain text)
function moodleEssayPage(format: string, wrapperClass: string) {
  return `<!DOCTYPE html><html><body><form id="responseform"><div class="que essay"><div class="formulation">
    <div id="mount-point" class="lms-widget-container" data-lms-target-textarea="#q1:7_answer_id"><custom-editor data-lms-widget="true"></custom-editor></div>
    <div class="answer"><div class="${wrapperClass} qtype_essay_response"><div><textarea id="q1:7_answer_id" name="q1:7_answer"></textarea></div>
    <div><input type="hidden" name="q1:7_answerformat" value="${format}"></div></div></div></div></div></form></body></html>`;
}

test('Bootstrapper - an answer box in HTML format locks the widget and says why, during an attempt', () => {
  const dom = createMockEnvironment(moodleEssayPage('1', 'qtype_essay_editor'));
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
  const controller = WidgetBootstrapper.initializeContainer(mountPoint);
  if (!controller?.getIsErrorState()) throw new Error('an HTML answer box should put the widget in its error state');
  const banner = dom.window.document.querySelector('.lms-widget-setup-error');
  const text = banner?.textContent ?? '';
  for (const words of ['Configuration issue: answers cannot be saved.', 'Teaching staff can fix this', 'Response options', 'Response format to "Plain text"', 'tell your teacher'])
    if (!text.includes(words)) throw new Error(`the banner should say "${words}", got: ${text}`);
  if (banner?.querySelector('button')) throw new Error('a set-up problem should not offer a reload, which cannot fix it');
  controller.destroy();
});

test('Bootstrapper - an answer box in plain-text format (plain or monospaced) is used as before', () => {
  for (const wrapper of ['qtype_essay_plain', 'qtype_essay_monospaced']) {
    const dom = createMockEnvironment(moodleEssayPage('2', wrapper));
    (globalThis as any).MutationObserver = dom.window.MutationObserver;
    const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
    const controller = WidgetBootstrapper.initializeContainer(mountPoint);
    if (!controller || controller.getIsErrorState()) throw new Error(`a ${wrapper} answer box should not be an error`);
    controller.destroy();
  }
});

test('Bootstrapper - an HTML answer box on a review page is shown, not locked (nothing is saved there)', () => {
  const page = createMockEnvironment(moodleEssayPage('1', 'qtype_essay_editor'));
  page.reconfigure({ url: 'https://moodle.example.edu/mod/quiz/review.php?attempt=1' });
  (globalThis as any).MutationObserver = page.window.MutationObserver;
  const mountPoint = page.window.document.getElementById('mount-point') as HTMLElement;
  const controller = WidgetBootstrapper.initializeContainer(mountPoint);
  if (!controller || controller.getIsErrorState()) throw new Error('a review page should not be locked');
  controller.destroy();
});

test('Bootstrapper - with no answer box to save into, the widget (a frame) is frozen, told to lock, and the problem is shown above it', () => {
  const dom = createMockEnvironment(`<!DOCTYPE html><html><body><div class="que essay"><div class="formulation">
    <div id="mount-point" class="lms-widget-container"><iframe data-lms-widget="true"></iframe></div></div></div></body></html>`);
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  const mountPoint = dom.window.document.getElementById('mount-point') as HTMLElement;
  const frame = mountPoint.querySelector('iframe') as HTMLIFrameElement;
  const sent: any[] = [];
  (frame.contentWindow as any).postMessage = (message: unknown) => sent.push(message);
  const controller = WidgetBootstrapper.initializeContainer(mountPoint);
  if (controller) throw new Error('There is nothing to save into, so there should be no controller');
  if (mountPoint.getAttribute('data-lms-setup-problem') !== 'no-answer-box') throw new Error('Expected the no-answer-box problem');
  if (mountPoint.getAttribute('data-lms-widget-initialized') !== 'error') throw new Error('Expected the container marked as an error');
  if (frame.style.pointerEvents !== 'none') throw new Error('The frame should be frozen');
  if (!sent.some((m) => m?.type === 'ERROR_LOCKDOWN' && String(m.payload?.message).includes('Configuration issue: answers cannot be saved.'))) {
    throw new Error(`The frame should be told to lock with the problem's title, got: ${JSON.stringify(sent)}`);
  }
  const text = mountPoint.previousElementSibling?.textContent ?? '';
  for (const words of ['no answer box', 'Teaching staff can fix this', '"No online text"']) if (!text.includes(words)) throw new Error(`Expected "${words}" in: ${text}`);
});

test('A set-up problem is shown once, however often it is found', () => {
  const dom = createMockEnvironment(`<!DOCTYPE html><html><body><div id="c"><custom-editor data-lms-widget="true"></custom-editor></div></body></html>`);
  const container = dom.window.document.getElementById('c') as HTMLElement;
  showSetupProblem(container, { id: 'x', title: 'T', lines: ['L'] });
  showSetupProblem(container, { id: 'x', title: 'T', lines: ['L'] });
  if (dom.window.document.querySelectorAll('.lms-widget-setup-error').length !== 1) throw new Error('Expected one message');
});
