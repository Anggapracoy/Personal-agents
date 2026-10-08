import type { RunningTask } from '../lib/types';
import type { AgentAction } from '../lib/harness/types';
import { interactionSummary, type AnswerSummary } from '../lib/harness/question-summary';

/** Presentation only; sending a reply never grants approval or executes an action. */
export function pendingInteractionSummary(task: RunningTask, action?: AgentAction): AnswerSummary {
  if (action) {
    const summary = interactionSummary({ ...action, status: 'rejected', result: null });
    if (summary) return summary;
  }
  const labels: Record<string, string> = {
    questions: 'Questions', connector: task.approvalRequest?.appName || 'App',
    signin: 'Sign-in', takeover: 'Browser step', reconnect: 'Google account',
    vault_login: 'Login details', vault_payment: 'Payment details',
    email_send: 'Email', purchase: 'Purchase',
  };
  return { id: `answers:${task.actionId}`, kind: 'answers', compact: true,
    createdAt: task.updatedAt,
    answers: [{ question: task.nativeAction ? 'iPhone action' : labels[task.approvalKind ?? ''] ?? 'Action', answer: 'Declined' }] };
}
