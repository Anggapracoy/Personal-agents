import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('opening native question cards never requests autofocus, including reopening and secret questions', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    encoding: 'utf8',
    input: `
      import React from 'react';
      import assert from 'node:assert/strict';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { QuestionsCard } from './app/approvals.tsx';
      globalThis.React = React;
      const task = { questionRequest: { questions: [{ id: 'q', question: 'What should I remind you about?', answerType: 'text', options: [] }] } };
      const render = () => renderToStaticMarkup(React.createElement(QuestionsCard, { task, skipping: false, onAnswered() {}, onSkip() {} }));
      assert.doesNotMatch(render(), /autofocus/i, 'Server rendering must not request focus before the shell is detected');
      globalThis.window = { webkit: { messageHandlers: { decisionFeedNative: { postMessage() {} } } } };
      assert.doesNotMatch(render(), /autofocus/i, 'Opening the native conversation must not summon the keyboard');
      assert.doesNotMatch(render(), /autofocus/i, 'Reopening the native conversation must also remain unfocused');
      task.questionRequest.questions[0].answerType = 'secret';
      assert.doesNotMatch(render(), /autofocus/i);
      globalThis.window = {};
      assert.match(render(), /autofocus/i, 'Desktop keyboard focus is retained');
    `,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
