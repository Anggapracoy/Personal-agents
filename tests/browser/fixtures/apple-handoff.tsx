import { recoverWorkspaceRuns } from "../../../lib/workspace-run-recovery";
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppleActionCard } from '../../../app/approvals';
import { TaskScreen } from '../../../app/task-screen';
import type { RunningTask } from '../../../lib/types';
import { AppleActionRunner } from '../../../app/apple-action-runner';
import { appleActionKey, createAppleActionExecutor } from '../../../app/apple-action-executor';

function CompletionRace() {
  const [pending, setPending] = useState(true);
  const executor = useRef(createAppleActionExecutor<boolean>());
  const task = { runId: 'apple-test', actionId: 'weather-action', nativeAction: { operation: 'weather.forecast', parameters: {}, readOnly: true }, draft: 'Check today’s weather' } as RunningTask;
  useEffect(() => executor.current.retain(new Set(pending ? [appleActionKey(task)] : [])), [pending]);
  const execute = () => executor.current.execute(appleActionKey(task), async () => {
    (window as any).executionCalls = ((window as any).executionCalls ?? 0) + 1;
    if ((window as any).executionCalls > 1) throw new Error('This iPhone action is already running.');
    return new Promise<boolean>(resolve => { (window as any).finishApple = () => { resolve(true); setPending(false); }; });
  });
  (window as any).hideApple = () => setPending(false);
  (window as any).showApple = () => setPending(true);
  return <div className="wd">
    {pending && <AppleActionRunner task={task} execute={execute} />}
    <TaskScreen conversationId="apple-race-test" title="Weather" kind="doc" state="watch" statusLabel="Waiting for iPhone" onBack={() => {}}
      items={[{ id: 'user', kind: 'user', text: 'What is the weather?' }]}
      inlinePanels={pending ? [{ id: 'approval:weather-action', summary: '', node: <div className="wd-apple-action-panel"><AppleActionCard task={task} onApprove={execute} onCancel={() => {}} /></div> }] : []} />
  </div>;
}

function Fixture() {
  const [pending, setPending] = useState(false);
  const task = { runId: 'apple-test', actionId: 'action', nativeAction: { operation: 'weather.current', parameters: {}, readOnly: true }, draft: 'Check the weather' } as RunningTask;
  (window as any).startApple = () => setPending(true);
  return <div className="wd"><TaskScreen conversationId="apple-handoff-test" title="Weather" kind="doc" state="watch" statusLabel="Waiting for iPhone" onBack={() => {}}
    items={[{ id: 'user', kind: 'user', text: 'What is the weather?' }]}
    inlinePanels={pending ? [{ id: 'approval:action', summary: '', node: <div className="wd-apple-action-panel"><AppleActionCard task={task} onApprove={async () => { await new Promise(resolve => setTimeout(resolve, 500)); setPending(false); return true; }} onCancel={() => {}} /></div> }] : []}
  /></div>;
}
function LostLocationSave() {
  const [task, setTask] = useState<RunningTask>();
  const [location, setLocation] = useState('');
  (window as any).restoreLostChat = () => {
    const state = recoverWorkspaceRuns({ decisions: [], tasks: [], history: [], discardedDecisionIds: [] }, [{
      id: 'lost-run', decisionId: 'lost-chat', category: 'social', title: 'Streetlight', request: 'Report streetlight',
      status: 'awaiting_approval', metadata: {}, updatedAt: new Date().toISOString(),
      pendingAction: { id: 'location-action', toolName: 'apple_device', input: { operation: 'location.current', parameters: {} }, preview: 'Current location' },
    } as any]);
    setTask(state.tasks[0]);
  };
  return <div>
    {task && <><div data-testid="recovered-chat">{task.title}</div><AppleActionRunner task={task} execute={async () => {
      const result = await (await import('../../../app/native-bridge')).requestNativeApple('execute', { runId: task.runId, actionId: task.actionId });
      setLocation(String((result as any).location)); return true;
    }} /></>}
    <div data-testid="location-result">{location}</div>
  </div>;
}
createRoot(document.getElementById('root')!).render((window as any).lostLocationSave ? <LostLocationSave /> : (window as any).completionRace ? <CompletionRace /> : <Fixture />);
