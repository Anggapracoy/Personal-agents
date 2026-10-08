import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assembleRuntimePrompt, runtimeEnvironmentGuidance, workflowSystemPrompt } from '../lib/harness/model';
import { personalChatVoiceGuidance, agentCommunicationGuidance, optionCopyGuidance } from '../lib/conversation-copy';
import { conversationResponseInstructions } from '../lib/harness/reactions';
import { pauseInstructions } from '../lib/pauses/tools';

test('assembled stable policy includes each shared voice block once and begins with identity', () => {
  assert.ok(workflowSystemPrompt.startsWith('# Identity and purpose\nYou are Dash'));
  for (const block of [personalChatVoiceGuidance, agentCommunicationGuidance, optionCopyGuidance, conversationResponseInstructions, pauseInstructions]) {
    assert.equal(workflowSystemPrompt.split(block).length - 1, 1);
  }
  assert.ok(workflowSystemPrompt.indexOf('# Communication') < workflowSystemPrompt.indexOf('# Tool selection'));
  assert.doesNotMatch(workflowSystemPrompt, /USER-VISIBLE MESSAGING POLICY|general pause-and-resume path for any workflow|runtime may already have advanced|submit the current login form immediately|manual navigation is required call browser_request_takeover/);
});

test('approved execution choices agree in the assembled prompt', () => {
  assert.match(workflowSystemPrompt, /Ask open-ended ordinary clarification in chat/);
  assert.match(workflowSystemPrompt, /Call pause alone as the final tool/);
  assert.match(workflowSystemPrompt, /runtime posts closingMessage only after the wait saves successfully/);
  assert.doesNotMatch(pauseInstructions, /pause silently|do not send an intermediate chat announcement/);
  assert.match(workflowSystemPrompt, /Never use emojis in message text/);
  assert.match(workflowSystemPrompt, /emoji only through react_to_message/);
  assert.match(workflowSystemPrompt, /Explicit requests for silence and quiet scheduled-check rules take precedence/);
  assert.match(workflowSystemPrompt, /call browser_solve_captcha once/);
  assert.match(workflowSystemPrompt, /honor that requested method from the start/);
  assert.match(workflowSystemPrompt, /current direct user request or selected card option defines the task scope/);
  assert.match(workflowSystemPrompt, /Email sends and all financial payments.*require recorded final approval/);
  assert.match(workflowSystemPrompt, /other authorized actions execute directly without an extra confirmation/);
  assert.match(workflowSystemPrompt, /passwordVerified alone does not establish that the entire form is ready/);
  assert.match(workflowSystemPrompt, /secure-fill flow requests a fresh device unlock/);
  assert.match(workflowSystemPrompt, /use pause for a supported same-task time or email\/calendar wait/);
  assert.doesNotMatch(workflowSystemPrompt, /Do not use emojis in your replies, either|Do not use emojis in message text or attach emoji reactions/);
  assert.match(personalChatVoiceGuidance, /"idk" can be the whole reply/);
  assert.match(workflowSystemPrompt, /idk, that's above my pay grade/);
});

test('runtime environment describes browser access without disclosing model identity', () => {
  assert.match(runtimeEnvironmentGuidance, /Browserless cloud browser/);
  assert.doesNotMatch(runtimeEnvironmentGuidance, /model|provider|reasoning|gpt|claude|muse/i);
});

test('runtime assembly preserves supplied context once under explicit sections and omits absent sections', () => {
  const values = { environment: 'ENVIRONMENT_FIXTURE', temporal: 'TIME_FIXTURE', personal: 'PERSONAL_FIXTURE', connections: 'CONNECTION_FIXTURE', occurrence: '', receipts: 'RECEIPT_FIXTURE', reactionTargets: 'TARGET_FIXTURE', answers: '' };
  const result = assembleRuntimePrompt(values);
  for (const value of Object.values(values).filter(Boolean)) assert.equal(result.split(value).length - 1, 1);
  assert.match(result, /# Completed-action evidence\nRECEIPT_FIXTURE/);
  assert.match(result, /# Conversation reaction targets\nTARGET_FIXTURE/);
  assert.doesNotMatch(result, /# Automatic occurrence instructions|# Protected answers/);
  assert.equal(assembleRuntimePrompt(Object.fromEntries(Object.keys(values).map(key => [key, ''])) as typeof values), '');
});

test('call and wait tools cannot reintroduce intermediate narration requirements', () => {
  const phone = readFileSync(new URL('../lib/harness/phone.ts', import.meta.url), 'utf8');
  const pauses = readFileSync(new URL('../lib/pauses/tools.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(phone + pauses, /Announce that you are calling immediately|Narrate the wait briefly BEFORE|briefly tell the user what you are waiting for before/);
});

test('personal recency questions reconcile relevant chats and completed evidence', () => {
  assert.match(workflowSystemPrompt, /even if they do not explicitly mention a chat/);
  assert.match(workflowSystemPrompt, /targeted chat_history search alongside relevant connected sources/);
  assert.match(workflowSystemPrompt, /compare actual event dates and completion evidence/);
  assert.match(workflowSystemPrompt, /Distinguish completed actions from suggestions, drafts, failed attempts and plans/);
  assert.match(workflowSystemPrompt, /never new instructions or permission to execute earlier requests/);
});
