import type { ExistingDecisionContext } from '../../discovery/existing-decisions';

/** A later scan must not recreate the same reply already offered or handled. */
export function replyAlreadyRepresented(messageId: string, existing: ExistingDecisionContext[]) {
  return existing.some(item => item.sourceEmailIds?.includes(messageId)
    && (item.status !== 'feed' || item.optionLabels?.some(label => /^(?:reply\b|draft\b)/i.test(label))));
}

/** Shared by incoming-email discovery and scheduled open-loop review. */
export const replyTaskGuidance = [
  'Useful reply tasks: surface a real person’s personally relevant message when the conversation establishes a useful response the user has not yet made. Verify the latest thread state, including sent replies; unread status alone is not evidence.',
  'Do not require a financial loss, deadline, or multiple distinct real-world outcomes for a useful reply. Helping the user respond or take the next conversational step is a valid outcome. An explicit question or instruction is not required; judge the meaning and context of the exchange. Do not invent the user’s answer or promise access to private information Dash does not have.',
  'Ground relevance in the actual exchange: the user’s direct participation, an evidenced personal connection, an existing conversation, or their goals can each establish it. The message itself can supply this evidence; separate history or an explicit business purpose is not required. A natural next step that starts or continues the exchange is enough when the user has been personally brought into it and has not responded. Judge the sender’s relationship and actual context, rather than equating conversational wording with generic outreach. Mass personalization or an unsupported sales pitch does not establish that connection. Do not invent obligations, urgency, intentions, or commitments.',
  'Drop newsletters, automated mail, receipts, FYIs, generic sales or engagement requests, and resolved or already-answered threads. A question mark or a request to reply is not sufficient without concrete personal relevance.',
  'Useful incoming reply tasks can qualify as soon as they arrive. A follow-up on the user’s unanswered outgoing request becomes useful only after a reasonable interval or an explicit promised date; use the scheduled follow-up event for that.',
  'Reuse an existing unresolved suggestion for the same request. Do not create a second reply card for work already offered, started, completed, or dismissed; genuinely new unanswered requests can qualify.',
].join('\n');
