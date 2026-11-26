# The grading protocol (draft)

How `lms-widget-manager` asks an answer widget to grade itself on a marker's page, and what it does with the result. The manager does not need to know what the widget is: it finds each
answer and its mark and comment fields on the LMS page, asks the widget to grade, and writes the result into the fields. Nothing is saved: the marker reads, changes and saves as always.

**Status: a proposal, with its structure built.** Grading is now an extension of the manager (section 7) with the LMS-specific parts behind an adapter. The messages are still PyPad's own
(`PYPAD_CONTROL`, op `checks`) and the author's block is still found by PyPad's name; this document is the generic form to move to, so that another widget can be graded by the same
button. Sections 9 and 10 say what is built and what is to decide.

## 1. Parts

| Part | Job |
|---|---|
| **Widget** | Shows the student's answer; can grade it when asked. Runs in a frame from the site that serves it |
| **Manager** | Runs on the LMS page. Its core sets widgets up and has one hook for extensions (a widget is ready) |
| **Grading extension** | Optional, part of the manager's bundle only if its entry file registers it (`src/grading`). Asks each widget, turns results into a mark and a comment |
| **Grading adapter** | The LMS-specific part of grading (`GradingAdapter`): where an answer's boxes are, what the author left for its widget, what a marker has already put in, how to write into the boxes. Moodle's is the only one so far (`src/adapters/grading/moodle.ts`) |
| **Grader information** | A box only markers can see (Moodle's *Information for graders*), where an author can leave a payload for the widget |

## 2. Messages

Every message is `{ type, payload }`, as the manager's other messages are, posted to a widget's frame, or from it to the page. The manager sends only to the frames of widgets it manages, and
takes replies only from the frame it asked (checking the frame, and the origin it was loaded from).

### 2.1 Saying it can grade

The widget's ready message (`WIDGET_READY`) may carry what it can do:

```js
{ type: 'WIDGET_READY', payload: { capabilities: { grade: { version: 1, kind: 'pypad', maxConcurrent: 2, sources: ['self', 'payload'] } } } }
```

- `version`: this protocol's version (1).
- `kind`: a name for the sort of widget. A payload block that names a kind is sent only to widgets of that kind (section 4). It is not a security boundary: a widget says its own kind, so the
  real limit is that the manager sends only to the widgets it manages.
- `maxConcurrent`: how many answers of this widget it can grade at once (default 2).
- `sources`: which of the sources in 2.2 it takes.

The manager shows its grading button only when a widget on the page says `grade`. A widget that says nothing is not asked.

### 2.2 Asking

```js
{ type: 'GRADE_REQUEST', payload: { id: 7, source: 'payload', data: '<text>' } }
```

| `source` | `data` | The widget grades with |
|---|---|---|
| `self` | none, or a key (below) | what it was given with the question: its template's tests or rules. Needs no payload |
| `payload` | the text the author left in the grader information | the tests or rules in `data`, **in place of** any it holds, so a student's changed copy cannot change the mark |
| `ref` | an address or id | what is found there (an autograder service). Later; the widget says it takes it in `sources` |

`self` may carry `data` too: a **key** for tests the widget holds sealed (encrypted), which the manager took from the grader information. The widget decrypts and runs them; one that
cannot, or whose sealed block is missing or changed, answers with an error, never with "no tests". (Not built; see section 10.)

`id` is the manager's own (a number or a string) and comes back in the answer. Requests to one widget may overlap if `maxConcurrent` allows.

### 2.3 Answering

```js
{ type: 'GRADE_RESULT', payload: { id: 7, ok: true, testsFrom: 'supplied',
    items: [ { id: 't1', name: 'doubles four', passed: true, points: 1, message: '' },
             { id: 't2', name: 'zero and negatives', passed: false, points: 3, message: 'AssertionError: …' } ] } }
{ type: 'GRADE_RESULT', payload: { id: 7, ok: false, error: 'The notebook is running: wait for it, or stop it.' } }
```

- `ok: false` carries `error`, one sentence for a person, never a code.
- `testsFrom` says what the grading used, so the marker knows how far to trust it:

  | Value | Meaning |
  |---|---|
  | `supplied` | the `data` the manager sent |
  | `template` | what the widget got with the question (its template), unsealed: the question's public and protected tests, as the author wrote them. Not the copy in a student's saved answer, which the widget puts back from the template (see 6). **Leaves out the author's private tests**, which are never in the template |
  | `sealed` | what the widget holds, sealed, opened with the key |
  | `remote` | a service, by `ref` |

- `items`: one for each test or rule, in order. `id` and `message` are optional; `points` defaults to 1 (0 or more).
- A widget with one score and no items sends `score: { gained, possible }` instead.
- `note`: optional plain text, a line for the marker.
- No HTML. The manager shows only text it escapes.

## 3. What the manager does with a result

- **Mark** = points of the items passed ÷ points of all items × the question's maximum mark, to two decimal places (Moodle's precision for a manual mark). From `score` when there are no items.
  An answer with no items and no `score` is "had no tests" and is left alone.
- **Comment** = a first line that says it was suggested, and from where (`testsFrom`), then each item, passed or not, with its points and the message of one that failed, then `note`.
  (`Suggested from the author's tests: 1 of 2 passed (1 of 4 points).` or `Suggested from the question's own tests (public and protected; no private tests were used): …`)
- **A mark or comment already in the box is left as it is**; the summary says how many. A tick, *Replace what is there*, writes over them.
- **Planned:** a choice of *Marks and comments* or *Comments only*; a button on each answer as well as the one for all.
- **Order and pace:** answers on the page, in page order, a few at a time: the manager's `concurrency` (default 2), or the widget's `maxConcurrent` if less. A widget that does not answer in
  five minutes is shown as *could not be run*.
- Nothing is saved. The mark and comment are written as if typed, so the LMS's own form and scripts see them, and the marker presses the LMS's own save.

## 4. Where a payload comes from

An author leaves it in the answer's grader information as a block no browser runs or shows:

```html
<script type="application/x-lms-grader" data-widget="pypad">
…the payload as text (the text `</script` is written `<\/script`)…
</script>
```

- The page adapter looks inside the answer's **own** block for it, so each answer gets its own question's payload and never another's. Moodle draws the grader information
  (`div.graderinfo`) inside each answer's block on the marking page, and only for a marker; it is not in a student's attempt or review (checked on Moodle 4.5, `tests/moodle/grader-tests.spec.ts`
  in PyPad).
- `data-widget` names the kind of widget it is for; the manager sends it only to widgets of that `kind`. Without it, to any.
- The manager passes the text on unread. What it means is the widget's.
- **The question can say its tests must come from the payload.** The question's own embed (in the question text, a different field from the grader information, so editing one does not touch the
  other) carries `data-lms-grader-source="payload"`, which reaches the widget's container with the other `data-lms-*` attributes. The manager then reads it:

  | Flag | Block found | The manager |
  |---|---|---|
  | `payload` | yes | sends it |
  | `payload` | **no** | **refuses**: the answer is skipped, and the status says the question's tests are missing from its grader information (a lost block, for example one the editor stripped, would otherwise be marked from fewer tests, with nothing to say so) |
  | none | yes | sends it |
  | none | no | asks with `source: 'self'`, and the comment says which tests were used |

  The question builder writes the flag whenever it writes a block. It is in the question text, so a hand edit there can remove it; the comment's first line is the second defence.

## 5. Finding an answer's fields

The page adapter's job, not the protocol's. Moodle 4.5: an answer is a `div.que` (`id="question-<usage>-<slot>"`); its fields are `q<usage>:<slot>_-mark`, `_-maxmark` (hidden) and `_-comment` (a
textarea, made into an editor: TinyMCE; Atto before Moodle 5). The marking page gives the answer's own read-only textarea **no name**, so the prefix is read from the mark or comment field
in the same block, then from the textarea's name, then from the block's id. A comment is written through its editor when there is one.

## 6. Safety

- **The payload is the widget's to read.** It runs in the marker's browser, so it can be read there. Keep what a student must not have (private tests, keys) in the grader information, which a
  student never receives, and never in the question's own text or the student's saved answer.
- **A widget's answer is data.** It is written as text. A widget cannot put markup or script into the LMS page, or choose which field is written: the manager does.
- **Only the manager's own frames** are sent requests, and only a reply from the frame asked, with the right `id`, is taken.
- **A student's saved answer does not supply tests.** PyPad merges the question's template with the saved answer: every setting and every locked cell (tests included) comes from the template, and
  from the answer only the text and output of cells the student could edit; a student's changes to a test cell are put back, and cells they add keep no settings (`mergeAnswer`,
  `packages/notebook/src/merge.ts`). Without a template, for a notebook opened on its own, there is nothing to put back, and the notebook's own tests are the student's copy.
- **Marks that matter need `supplied` or `sealed`,** because `template` has no private tests.
- **Student code and the tests share a Python** in PyPad today; a student's code could read the tests while they run. Only a second Python for the tests closes that (PyPad's `docs/TESTING.md`, Part B).

## 7. The manager's structure, and other LMSs

The protocol and the scoring (`src/grading/scoring.ts`) name no LMS. A second LMS needs a `GradingAdapter` (`src/grading/adapter.ts`: where an answer's boxes are, what the author left for its widget,
whether a marker has already put something in, how to write a mark and a comment) and nothing in the widgets.

### The extension

Grading attaches to the manager through one hook (`src/core/extensions.ts`): `registerExtension({ name, widgetReady(controller, context) })`, called for each widget once its messenger is ready.
The entry file registers the grading extension (`registerExtension(gradingExtension)` in `src/index.ts`): take the line out and grading is not in the bundle. On a page, `data-lms-grading="off"` on a
widget's container, or on any element around it, leaves the page without the button. An extension that throws does not stop the others or the widget. (A separate file for grading, loaded only on
a marking page, so that students never download it, is possible from here and not done.)

## 8. Example

A PyPad question exported by its question builder holds the author's notebook (a solution, a public test, a private test worth 3 points) in the grader information. On *Manual grading* the manager
finds the block in each answer's block, asks the answer's PyPad with `source: 'payload'`, and gets two items back: the public test passed (1 point), the private one failed (3). Mark: 1 of 4
points × the question's 1.00 = 0.25.

## 9. What is built, and how PyPad maps to it

| | Now | Here |
|---|---|---|
| Messages | `PYPAD_CONTROL` op `checks`, args `{ tests }`; reply `PYPAD_CONTROL_RESULT` | `GRADE_REQUEST` / `GRADE_RESULT` |
| Result | `{ checks: [{ id, name, passed, points, message }], passed, total }` | `items` (the same fields), `testsFrom` |
| Sources | `payload` (the author's notebook, as `tests`) and `self` (no `tests`) | the same, named |
| Payload block | `<script type="text/x-pypad-author">` | `application/x-lms-grader` with `data-widget="pypad"` |
| Capabilities | none: the button appears for any widget in grade mode | `grade` in the ready message |
| Structure | built: an extension (`src/grading`), a `GradingAdapter` (Moodle's in `src/adapters/grading/moodle.ts`), `data-lms-grading="off"` | the same |
| Fields | from the answer's own block (built) | the same |
| No overwrite | built | the same |
| `data-lms-grader-source` | not built | refuse when the question says `payload` and there is none |
| Comment's first line | says it was suggested | says from where (`testsFrom`) |

PyPad would answer `GRADE_REQUEST` by running its `checks`: `source: 'payload'` gives `tests`, `self` gives none; `testsFrom` is `supplied` or `template`. Its `PYPAD_CONTROL` stays, for a page that embeds
and drives PyPad.

## 10. Decided, and to decide

**Decided** (2026-11-26; the first two are proposals taken as the working rule, to change if they do not suit):

- A block that names a kind (`data-widget`) goes only to a widget of that kind; a block with no name goes to any widget. Not a security boundary.
- The question can declare `data-lms-grader-source="payload"`; the manager refuses to mark from the template alone when it does and no payload is found; otherwise it marks from the template and says
  so. (The unsealed fallback is `template`: tamper-proof, since the saved answer is not used, but without private tests.)
- Grading is an extension with an adapter, and can be switched off on a page.

**To decide**

1. The names: `GRADE_REQUEST`, `GRADE_RESULT`, `application/x-lms-grader`, `data-lms-grader-source`.
2. `ref`: what an address means, and who fetches it (the widget or the manager).
3. Sealed tests (`self` with a key): the sealing, and where the key comes from for each LMS. In PyPad, step T6 of `docs/TESTING.md`.
4. A `maxConcurrent` for the manager's own default, per site.
5. Whether to build grading as a file of its own, loaded only on a marking page.
