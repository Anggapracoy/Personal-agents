import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('opening a chat renders cached transcript messages without synthetic history receipts', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    encoding: 'utf8',
    input: `
      import React from 'react';
      import assert from 'node:assert/strict';
      import { renderToString } from 'react-dom/server';
      import { TaskRoute } from './app/task-route.tsx';
      import { decisionResultFailed } from './app/workspace-model.ts';
      globalThis.React = React;
      assert.equal(decisionResultFailed({ selectedOption: 'I guess accept it lol', result: { outcome: 'completed', externalChange: false } }), false);
      assert.equal(decisionResultFailed({ selectedOption: 'Draft a reply', result: { outcome: 'needs_user', externalChange: false } }), true);
      const entry = { id: 'receipt', runId: 'run', decisionId: 'decision', title: 'Chat', category: 'social', status: 'done', chosenOption: 'User request', outcome: 'Saved answer', completedAt: '2026-09-07T00:00:00Z' };
      const props = { id: 'receipt', decisions: [], tasks: [], history: [entry], snapshots: new Map(), previewMode: false, actions: {} };
      assert.doesNotMatch(renderToString(React.createElement(TaskRoute, props)), /Saved answer/);
      const running = { id: 'task-run', runId: 'run', decisionId: 'decision', title: 'Email chat', category: 'social', status: 'running', subtitle: 'Finishing without sending', chosenOption: 'Draft an email' };
      const stableCache = new Map([['run', [{ id: 'prior', kind: 'agent', text: 'Your email draft is ready' }]]]);
      for (const id of ['decision', 'task-run', 'run']) {
        const active = renderToString(React.createElement(TaskRoute, { ...props, id, history: [], tasks: [running], messageCache: stableCache }));
        assert.match(active, /Your email draft is ready/);
        assert.match(active, /Email chat/);
        assert.doesNotMatch(active, /Dash is typing/);
      }
      const opening = { id: 'run:opening', kind: 'agent', text: 'The proposed time is free' };
      const submitted = { id: 'run:submitted', kind: 'user', text: 'ask if thursday works instead' };
      const decision = { id: 'decision', title: 'Choose a time', subtitle: opening.text, category: 'calendar', activeRunId: 'run', options: [] };
      const snapshot = { id: 'run', title: decision.title, status: 'running', metadata: {}, actions: [], artifacts: [], steps: [] };
      for (const threadItems of [undefined, [opening], [opening, { ...submitted, id: 'saved-reply', deliveredAt: '2026-09-07T00:00:00Z' }]]) {
        const html = renderToString(React.createElement(TaskRoute, { ...props, id: 'decision', history: [], decisions: [decision], tasks: [running], snapshots: new Map([['run', { ...snapshot, threadItems }]]), messageCache: new Map([['run', [opening, submitted]]]) }));
        assert.match(html, /The proposed time is free/);
        assert.equal(html.split(submitted.text).length - 1, 1, 'submitted reply stays visible exactly once across server handoff');
        assert.equal(html.includes('Delivered'), Boolean(threadItems?.some(item => item.deliveredAt)));
      }
      const messageCache = new Map([['run', [{ id: 'message', kind: 'agent', text: 'Latest loaded response' }]]]);
      const html = renderToString(React.createElement(TaskRoute, { ...props, messageCache }));
      assert.match(html, /Latest loaded response/);
      const legacyFailure = { ...entry, status: 'failed', outcome: 'Done.', chosenOption: 'I guess accept it lol' };
      for (const snapshots of [new Map(), new Map([['run', { ...snapshot, status: 'done', threadItems: messageCache.get('run') }]])]) {
        const reopened = renderToString(React.createElement(TaskRoute, { ...props, history: [legacyFailure], messageCache, snapshots }));
        assert.match(reopened, /Latest loaded response/);
        assert.doesNotMatch(reopened, /Done\\.|Try again/);
      }
      const actualFailure = { ...snapshot, status: 'failed', error: 'Browser connection expired', request: 'Check the account', response: '', updatedAt: '2026-09-07T00:00:00Z', threadItems: messageCache.get('run') };
      const failed = renderToString(React.createElement(TaskRoute, { ...props, history: [legacyFailure], messageCache, snapshots: new Map([['run', actualFailure]]) }));
      assert.match(failed, /Browser connection expired/);
      assert.match(failed, /Try again/);
      assert.doesNotMatch(failed, /Done\\./);

      assert.doesNotMatch(html, /Saved answer/);
      assert.doesNotMatch(renderToString(React.createElement(TaskRoute, { ...props, id: 'other-run', history: [], messageCache })), /Latest loaded response/);
    `,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
