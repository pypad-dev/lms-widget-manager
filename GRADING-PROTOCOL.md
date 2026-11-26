# The grading protocol (draft)

How `lms-widget-manager` asks an answer widget to grade itself on a marker's page, and what it does with the result. The manager does not need to know what the widget is: it finds each
answer and its mark and comment fields on the LMS page, asks the widget to grade, and writes the result into the fields. Nothing is saved: the marker reads, changes and saves as always.

**Status: a proposal.** Today the manager speaks PyPad's own control messages (`PYPAD_CONTROL`, op `checks`; see section 9), and finds PyPad's block by name. This document is the
generic form to move to, so that another widget can be graded by the same button. Sections 9 and 10 say what is built and what is to decide.

## 1. Parts

| Part | Job |
|---|---|
| **Widget** | Shows the student's answer; can grade it when asked. Runs in a frame from the site that serves it |
| **Manager** | Runs on the LMS page. Coordinates: finds the answers, asks each widget, turns results into a mark and a comment |
| **Page adapter** | The LMS-specific part of the manager: where an answer's block is, what its mark and comment fields are called, how to write into a comment's editor. Moodle's is the only one so far |
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
- `kind`: a name for the sort of widget; the manager matches a payload block to widgets of its kind (section 4).
- `maxConcurrent`: how many answers of this widget it can grade at once (default 2).
- `sources`: which of the sources in 2.2 it takes.

The manager shows its grading button only when a widget on the page says `grade`. A widget that says nothing is not asked.

### 2.2 Asking

```js
{ type: 'GRADE_REQUEST', payload: { id: 7, source: 'payload', data: '<text>' } }
```

| `source` | `data` | The widget grades with |
|---|---|---|
| `self` | none, or a key (below) | what it already holds: its own tests or its own rules. Needs no payload |
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
  | `own` | what the widget holds, unsealed (**not tamper-proof**: it is in the student's saved answer) |
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
  (`Suggested from the tests (the author's): 1 of 2 passed (1 of 4 points).`)
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
- No block: the manager asks with `source: 'self'`.

## 5. Finding an answer's fields

The page adapter's job, not the protocol's. Moodle 4.5: an answer is a `div.que` (`id="question-<usage>-<slot>"`); its fields are `q<usage>:<slot>_-mark`, `_-maxmark` (hidden) and `_-comment` (a
textarea, made into an editor: TinyMCE; Atto before Moodle 5). The marking page gives the answer's own read-only textarea **no name**, so the prefix is read from the mark or comment field
in the same block, then from the textarea's name, then from the block's id. A comment is written through its editor when there is one.

## 6. Safety

- **The payload is the widget's to read.** It runs in the marker's browser, so it can be read there. Keep what a student must not have (private tests, keys) in the grader information, which a
  student never receives, and never in the question's own text or the student's saved answer.
- **A widget's answer is data.** It is written as text. A widget cannot put markup or script into the LMS page, or choose which field is written: the manager does.
- **Only the manager's own frames** are sent requests, and only a reply from the frame asked, with the right `id`, is taken.
- **A widget that grades itself (`own`) can be tampered with by a student** who edits their saved answer. The comment says so; marks that matter should come from `supplied` or `sealed`.
- **Student code and the tests share a Python** in PyPad today; a student's code could read the tests while they run. Only a second Python for the tests closes that (PyPad's `docs/TESTING.md`, Part B).

## 7. Other LMSs

The protocol and the scoring are the manager's core; the page adapter is the only LMS-specific part. A second LMS needs its adapter (where answers are, their mark and comment fields, how to write
them) and nothing in the widgets.

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
| Fields | from the answer's own block (built) | the same |
| No overwrite | built | the same |

PyPad would answer `GRADE_REQUEST` by running its `checks`: `source: 'payload'` gives `tests`, `self` gives none; `testsFrom` is `supplied` or `own`. Its `PYPAD_CONTROL` stays, for a page that embeds
and drives PyPad.

## 10. To decide

1. The names: `GRADE_REQUEST` and `GRADE_RESULT`, and the block type `application/x-lms-grader`.
2. Whether a widget's `kind` and a block's `data-widget` must match, or are only a hint.
3. `ref`: what an address means, and who fetches it (the widget or the manager).
4. Sealed tests (`self` with a key): the sealing, and where the key comes from for each LMS. In PyPad, step T6 of `docs/TESTING.md`.
5. Whether `testsFrom` should change what the manager does (refuse `own` for a question that says it needs sealed or supplied tests), or only what it says.
6. A `maxConcurrent` for the manager's own default, per site.
