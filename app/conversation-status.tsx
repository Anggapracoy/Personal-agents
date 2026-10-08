import { ChoiceReceipt } from "./choice-options";
import { Receipt, ReceiptGlyph, Receipts } from "./receipt";
import { ConnectorReceipt } from "./connector-card";
import type { WaitSummary } from "../lib/harness/wait-summary";
import { SiteReceiptIcon } from "./site-receipt-icon";
import { FinancialApprovalIcon } from "./checkout-icon";
import { PaymentCardIcon } from "./payment-card-icon";
import { SourceIcon } from "./source-icon";
import type { CallSummary } from "../lib/harness/call-summary";
import type { PauseDisplay } from "../lib/pauses/definition";
import type { AnswerSummary } from "../lib/harness/question-summary";

export function AnswersSummary({ answers, compact, vault, purchase, signin, connector }: Pick<AnswerSummary, "answers" | "compact" | "vault" | "purchase" | "signin" | "connector">) {
  if (connector) return <ConnectorReceipt name={connector.name} logo={connector.logo} status={connector.status} />;
  if (answers.length && answers.every(item => item.choice)) return <ChoiceReceipt answers={answers} />;
  if (compact && signin) return <Receipt icon={<SiteReceiptIcon host={signin.host} />} title={signin.host} detail={[signin.detail, signin.status]} label={`${signin.host}, ${signin.detail}, ${signin.status}`} />;
  if (compact && (purchase || ["Purchase", "Bill payment", "Transfer", "Payment"].includes(answers[0]?.question ?? ""))) {
    const decision = answers[0]?.answer || "Approved";
    const label = purchase?.approvalType === "bill_payment" ? "Bill payment" : purchase?.approvalType === "transfer" ? "Transfer" : purchase?.approvalType === "payment" ? "Payment" : "Purchase";
    return <Receipt icon={<FinancialApprovalIcon type={purchase?.approvalType ?? "purchase"} />} title={decision === "Approved" ? `${label} approved` : `${label} · ${decision}`} detail={purchase?.merchant || "Online checkout"} />;
  }
  if (compact && vault) return <Receipt icon={vault.kind === "login" ? <SourceIcon name="passwords" /> : <PaymentCardIcon brand={vault.detail.split("•")[0].trim()} />} title={vault.label} detail={vault.detail} label={`Selected ${vault.kind === "login" ? "login" : "card"}: ${vault.label}, ${vault.detail}`} />;
  return <Receipts label={compact ? "Your response" : "Your answers"}>{answers.map((item, index) => <Receipt key={index} icon={<ReceiptGlyph kind={item.question === "Email" ? "email" : "answers"} />} title={item.question} detail={item.answer} />)}</Receipts>;
}

export function WaitStatus({ pause }: { pause: PauseDisplay }) {
  const call = pause.eventKind === "phone_call" ? pause.phoneCall : undefined;
  const title = call ? call.status === "in_progress" ? "On the phone" : "Calling" : "Waiting";
  const date = pause.wakeAt ? new Date(pause.wakeAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const detail = call ? "I’ll return here when the call ends." : pause.eventKind ? `I’ll continue when it happens.${date ? ` I’ll check again ${date}.` : ""}` : date ? `I’ll continue ${date}.` : "I’ll continue when it’s time.";
  return <Receipt live icon={<ReceiptGlyph kind={call ? "phone" : "wait"} />} title={title} detail={[call ? call.recipientName : pause.reason, detail]} />;
}

export function CompletedCall({ call }: { call: CallSummary }) {
  const seconds = call.durationSeconds;
  const duration = seconds === undefined ? "Duration unavailable" : seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ""}`;
  return <Receipt label="Completed call" failed={call.failed} icon={<ReceiptGlyph kind="phone" />} title={call.recipient} detail={[call.failed ? "Call unsuccessful" : "Call completed", duration]} />;
}

/** Ending a wait does not necessarily mean the awaited event happened. */
export function WaitReceipt({ wait }: { wait: Pick<WaitSummary, "reason" | "activePause"> }) {
  if (wait.activePause) return <WaitStatus pause={wait.activePause} />;
  return <Receipt label="Ended wait" icon={<ReceiptGlyph kind="wait" />} title="Waiting ended" detail={wait.reason ? wait.reason.replace(/^waiting\b/i, "Waited") : null} />;
}
