import type { AgentAction } from "./types";
import { nonFinancialControl } from "./browser/financial-approval";

export type AnswerSummary = { id: string; kind: "answers"; createdAt?: string; compact?: boolean; connector?: { name: string; logo?: string; status: string }; signin?: { host: string; detail: string; status: string }; purchase?: { merchant: string; approvalType?: "bill_payment" | "transfer" | "payment" }; vault?: { kind: "login" | "payment_card"; label: string; detail: string }; answers: Array<{ question: string; answer: string; choice?: boolean; selectedOptions?: Array<{label:string}> }> };

export function maskedLoginHint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const hint = value.trim().slice(0, 320);
  const at = hint.indexOf("@");
  return at > 0 ? `${hint.slice(0, Math.min(2, at))}•••${hint.slice(at)}` : `${hint.slice(0, 2)}•••`;
}

/** Only the user's decision belongs here, never a task title, page snapshot or secret. */
export function interactionSummary(action: AgentAction): AnswerSummary | null {
  if (action.result?.$reusedFromActionId) return null;
  const questions = questionSummary(action);
  if (questions) return questions;
  const skipped = action.result?.userSkipped === true || action.result?.userDeniedApproval === true || action.status === 'rejected';
  const answered = skipped || Boolean(action.approvedBy) || action.status === 'executed';
  if (!answered || action.status === 'proposed') return null;
  let question: string;
  let answer: string;
  switch (action.toolName) {
    case 'connector_request_connection': question = String(action.input.name ?? 'App'); answer = action.result?.connected === true && action.status === 'executed' ? 'Connected' : 'Not connected'; break;
    case 'ask_questions': question = 'Questions'; answer = 'Answered'; break;
    case 'vault_request_item': question = action.input.kind === 'payment_card' ? 'Payment details' : 'Login details'; answer = 'Provided securely'; break;
    case 'vault_fill_login': question = 'Saved login'; answer = 'Unlocked securely'; break;
    case 'vault_fill_payment': question = 'Saved card'; answer = 'Unlocked securely'; break;
    case 'browser_request_signin': question = 'Sign-in'; answer = 'Session shared'; break;
    case 'browser_request_takeover': question = action.input.mode === 'wait_for_user' ? 'Your step' : 'Browser step'; answer = 'Finished'; break;
    case 'google_request_reconnect': question = 'Google account'; answer = 'Reconnected'; break;
    default:
      // Ordinary background tools must not add receipts to the conversation.
      if (!action.approvedBy && !skipped) return null;
      // Older runs may have incorrectly tagged deletion/login clicks as payments.
      // Re-project saved and cached history without fabricating a user decision.
      if (["browser_click", "browser_press"].includes(action.toolName) && nonFinancialControl(String(action.input.elementName ?? ""))) return null;
      if (action.toolName === 'gmail_send_draft' || action.input.approvalCategory === 'email_send') question = 'Email';
      else if (action.input.approvalType === 'bill_payment') question = 'Bill payment';
      else if (action.input.approvalType === 'transfer') question = 'Transfer';
      else if (action.input.approvalType === 'payment') question = 'Payment';
      else if (action.input.approvalCategory === 'purchase' || action.input.approvalType === 'purchase') question = 'Purchase';
      else return null;
      answer = 'Approved';
  }
  if (skipped) answer = action.result?.userDeniedApproval === true || action.status === 'rejected' && !action.result?.userSkipped ? 'Declined' : 'Skipped';
  else if (action.status === 'failed') answer = 'Couldn’t finish';
  else if (action.status === 'approved' && !['vault_fill_login', 'vault_fill_payment'].includes(action.toolName)) answer = 'Approved';
  // A malformed question receipt cannot claim an answer that wasn't saved.
  if (action.toolName === 'ask_questions' && !skipped) return null;
  const selected = action.result?.selectedItem;
  let vault: AnswerSummary["vault"];
  if (!skipped && action.status === "executed" && ["vault_request_item", "vault_fill_login", "vault_fill_payment"].includes(action.toolName) && selected && typeof selected === "object") {
    const item = selected as Record<string, unknown>;
    const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const kind = action.input.kind === "payment_card" || action.toolName === "vault_fill_payment" ? "payment_card" : "login";
    const last4 = typeof item.cardLast4 === "string" && /^\d{4}$/.test(item.cardLast4) ? item.cardLast4 : "";
    vault = { kind, label: text(item.label, 120) || (kind === "login" ? "Saved login" : "Saved card"), detail: kind === "login" ? text(item.usernameHint, 320) || "Unlocked securely" : [text(item.cardBrand, 32), last4 ? `•••• ${last4}` : ""].filter(Boolean).join(" ") || "Unlocked securely" };
  }
  let signin: AnswerSummary["signin"];
  if (action.toolName === "browser_request_signin" || vault?.kind === "login") {
    let host = "Website";
    try { host = new URL(String(action.input.pageUrl ?? "")).hostname.replace(/^www\./, ""); } catch { /* No invented website. */ }
    const hint = vault?.kind === "login" ? maskedLoginHint((selected as Record<string, unknown>)?.usernameHint) : "";
    signin = { host, detail: hint || (vault ? "Saved login" : "Browser session"), status: vault ? "Unlocked securely" : answer };
  }
  let purchase: AnswerSummary["purchase"];
  if (["Purchase", "Bill payment", "Transfer", "Payment"].includes(question)) {
    let merchant = "Online checkout";
    try { merchant = new URL(String(action.input.pageUrl ?? "")).hostname.replace(/^www\./, "") || merchant; } catch { /* Keep a neutral label for missing URLs. */ }
    purchase = { merchant, ...(question === "Purchase" ? {} : { approvalType: question === "Bill payment" ? "bill_payment" as const : question === "Transfer" ? "transfer" as const : "payment" as const }) };
  }
  return { id: `answers:${action.id}`, kind: 'answers', compact: true, ...(action.toolName === 'connector_request_connection' ? { connector: { name: question, logo: typeof action.input.logo === 'string' ? action.input.logo : undefined, status: answer } } : {}), ...(signin ? { signin } : {}), ...(purchase ? { purchase } : {}), ...(vault ? { vault } : {}), createdAt: action.approvedAt ?? action.executedAt ?? action.createdAt, answers: [{ question, answer }] };
}

/** Only presentation-safe values leave this projection, even for malformed secret receipts. */
export function questionSummary(action: AgentAction): AnswerSummary | null {
  if (action.toolName !== "ask_questions" || action.status !== "executed" || !Array.isArray(action.input.questions) || !Array.isArray(action.result?.responses)) return null;
  const answers = action.input.questions.flatMap(question => {
    if (!question || typeof question.question !== "string") return [];
    const response = (action.result!.responses as Array<Record<string, unknown>>).find(r => r && r.questionId === question.id);
    if (!response) return [];
    const secret = question.answerType === "secret" || response.answerType === "secret" || Boolean(response.secretKey);
    const selected = Array.isArray(question.options) && Array.isArray(response.selectedOptionIds)
      ? question.options.filter((o: { id: string }) => (response.selectedOptionIds as unknown[]).includes(o.id)).map((o: { label: unknown }) => typeof o.label === "string" ? o.label : "").filter(Boolean).join(", ") : "";
    const answer = secret ? "Secure answer provided" : selected || (typeof response.text === "string" ? response.text : "");
    return answer ? [{ question: question.question, answer, choice: !secret && (question.answerType === "single_choice" || question.answerType === "multiple_choice"), ...(!secret && Array.isArray(question.options) ? {selectedOptions:question.options.flatMap((option: {id:string;label:string},index:number)=>response.selectedOptionIds instanceof Array && response.selectedOptionIds.includes(option.id)?[{label:option.label}]:[])} : {}) }] : [];
  });
  return answers.length ? { id: `answers:${action.id}`, kind: "answers", createdAt: action.executedAt ?? action.approvedAt ?? action.createdAt, answers } : null;
}

/** Handles tool calls omitted from a saved SDK checkpoint and snapshots arriving before message refresh. */
export function includeAnsweredQuestions<T extends { id: string; createdAt?: string }>(items: T[], actions: AgentAction[]): Array<T | AnswerSummary> {
  const summaries = actions.flatMap(action => { const summary = interactionSummary(action); return summary ? [summary] : []; });
  const ids = new Set(actions.map(action => `answers:${action.id}`));
  const result: Array<T | AnswerSummary> = items.filter(item => !ids.has(item.id));
  for (const summary of summaries) {
    const answeredAt = Date.parse(summary.createdAt ?? "");
    const next = Number.isFinite(answeredAt) ? result.findIndex(item => Date.parse(item.createdAt ?? "") > answeredAt) : -1;
    result.splice(next < 0 ? result.length : next, 0, summary);
  }
  return result;
}
