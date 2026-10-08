# Browser scripting

The model-facing ordinary browser interface is `browser_run({code, purpose})`.
It replaces separate model-facing click/type/navigation tools. Those implementations
remain internal and keep their existing per-action receipts, approval gates,
execution ownership checks, steering checks, and browser session protection.
The credential, device unlock, CAPTCHA, sign-in, and takeover tools remain separate.

## Execution contract

- JavaScript runs in QuickJS/WASM, with no Node, host filesystem, network, module
  loader, or vault access. Only validated JSON browser calls cross the boundary.
- `await` actions in order. Variables, branches, arrays and loops are supported.
  Handles can be reused within a script. JavaScript variables do not persist across
  calls; browser state and task-owned tab IDs do.
- Each script has a 32-operation budget, 24 MB heap, 512 KB stack and 120-second
  deadline checked by the interpreter and before dispatch. An in-flight controller
  operation retains its own timeout; it is never retried on deadline/error.
- An operation failure, uncertain outcome, approval request or cancellation latches
  the runner closed. Catching the error in JavaScript cannot dispatch more actions.
  Completed steps remain completed. Resume only unfinished work in a new script.
- `print(value)` returns selected findings. The final action's receipt is returned.
  A screenshot is model-visible only when it is the final browser action. Newer
  actions invalidate earlier screenshots, including failed actions.

## API

`browser.page()` refers to the currently selected task tab. `browser.tab(id)` creates
an explicit handle. `browser.tabs.list()` and `.new()` expose only this task's tabs
and their popups. Opening a tab produces an isolated blank tab in the same profile;
use `page.goto(observedUrl)` to navigate. Closing/switching cannot select other runs.

Page methods: `goto`, `back`, `forward`, `reload`, `inspect`, `screenshot`, `title`,
`url`, `close`, `scroll`, `wait`, `evaluate`, `dialog`, `logs`, `download`.

Locators: `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`,
`locator(css)`, `ref`. Chain `locator`, `getByRole`, `getByText`, `filter({hasText})`,
`nth`, `first`, `last`. `page.frame(frameIdOrUrl)` scopes locators to a frame.

Read methods: `count`, `all`, `innerText`, `allTextContents`, `getAttribute`,
`isVisible`, `isEnabled`, `isChecked`. Attributes are restricted to presentation
and link metadata; editable values are not returned through this interface.

Actions: `click`, `dblclick`, `fill`, `type` (append), `press`, `pressSequentially`,
`hover`, `check`, `uncheck`, `setChecked`, `selectOption`, `waitFor`, `copy`, `paste`,
`setInputFiles`. Single-target actions reject ambiguity and re-resolve the locator
against current DOM state. Missing targets briefly auto-wait; existing input
readiness checks still apply. Keyboard supports named keys, modifier chords,
printable characters and short alphanumeric sequences. `ControlOrMeta` maps to
Control on Linux Browserless and Meta in the local macOS fixture.

`page.evaluate(expression)` uses CDP `throwOnSideEffect` and a 1-second execution
limit. It is unavailable on pages containing password or securely filled fields.
It cannot mutate the page or replace the guarded action path.

The clipboard is task-local text, not the account/browser/OS clipboard.
Copy/cut/paste keyboard shortcuts also use this task-local buffer and reject secure
pages. Console diagnostics expose event metadata, not potentially sensitive argument
values. Pending JavaScript dialogs are reported without waiting for them to close.

Uploads take `{artifactId}` entries belonging to the current run. Downloads take an
observed direct public HTTPS URL and save a run artifact. Downloads are bounded to 10 MB; uploads allow at most five files totaling 10 MB. Uploads use the actual DOM file input,
including inputs opened by a chooser, without automating OS picker windows.

## Validation

```sh
pnpm test
pnpm lint
pnpm build
pnpm exec tsx scripts/browser-extended-local-smoke.ts
pnpm exec tsx scripts/browserless-controls-smoke.ts
pnpm exec tsx scripts/agent-capability-eval.ts --case=gpt-sol-cloud-browser-shopping-medium --compact
```

The local fixture uses a disposable Chrome profile, temporary upload files and a
local HTTP server. The separate Browserless controls fixture validates the production
transport directly. Local Chrome transport timeouts must not be mistaken for a
passing check. The shopping evaluation uses the real harness, GPT-6 Sol and
Browserless; it performs product research, product-page verification and screenshot
capture, then adds a variant to the cart, verifies its quantity, removes it and
checks that the cart is empty, without checking out or purchasing anything. Do not treat a passed shopping run as proof
that every merchant, payment provider or browser interaction works.

## Page-level keyboard input

For an observed keyboard interface without editable focus, use
`page.keyboard.type(text,{purpose})` and
`page.keyboard.press('Enter',{purpose,requiresApproval:false})` in the same script.
Page presses support Enter, Backspace, Escape and arrows only. They reject secure
pages, non-neutral focus, open dialogs, visible forms/fields and consequential
controls. Enter additionally requires recent page typing on the same page and
browser generation; navigation invalidates it. Forms, purchase/email submission,
Tab and shortcuts retain exact-target `locator.press` and normal approval.

An unused literal page type immediately followed by a known page press can omit
the intermediate snapshot; the press still validates live focus and returns its
full observation. Consumed typing results, branches, dynamic arguments and
intervening steps retain ordinary observations. Partial failures stop the script;
inspect before continuing and never replay already-typed text.

Local comparison: `node --conditions=react-server --import tsx
scripts/benchmarks/page-keyboard-speed.ts`. It runs five alternating trials per
arm through the production controller on local Chromium, with four known guesses
and a fixed DOM. It verifies accepted guesses and blocked focus/form/dialog/key
cases. No model, Browserless, E2B or production database is used; local timings
do not predict total production-task time.

## Frame lookup performance

Queries for already-observed controls read live frame contents together in one
CDP batch. They do not cache text, names, visibility or values. If any matching
node needs a new identity, resolution falls back to the original ordered ref
allocator; duplicate matches and frame errors remain failures. Existing ref
attributes are no longer rewritten during reads. Ref lookup, fresh preflight and approval checks remain in place. A known ref's
frame context is tried first, with rediscovery if
it is stale. CDP pool protocol 19 activates the new read-batch operation.

Run `scripts/benchmarks/multiframe-locator-speed.ts` with the normal TypeScript
loader for a local comparison against the prior lookup path.
`BROWSER_BENCHMARK_RTT_MS=50` adds a 25ms delay in each direction through a local
TCP proxy; report this separately as simulated network latency. The baseline
flag exists only in the local benchmark transport.

## Existing targets and ambiguous lookups

Use supplied element refs by default: `page.ref(ref)` acts on the current observed
control, including unnamed/icon-only controls. If the needed control is missing,
call `page.inspect()` without a target as the final browser action to return the
unscoped page tree, and read it before fallback searching. Do not slice away the
missing area or invent a button label. Locator search must use observed names,
attributes or frame/container scope. Deferred-frame warnings mean incomplete
evidence; combine exposed refs with a screenshot to identify an unlabeled control.
Do not search again solely to rediscover an already supplied element. Navigation, a
changed page, stale refs or missing evidence justify another lookup/inspection;
normal input preflight remains mandatory either way.

When a click/press lookup matches multiple controls, it dispatches no input and
returns up to 20 fresh candidates: ref, role/name, visibility, enabled state,
containing dialogs/forms/regions and frame identity. No values, raw text or HTML
are included. The script stops and marks the lookup as read-only evidence. Pick
the intended ref or scope in the next script; inspect only if the candidates are
insufficient or the page changed. Candidate labels remain untrusted page data.
