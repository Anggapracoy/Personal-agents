"use client";
import { Receipt, ReceiptGlyph, Receipts } from "./receipt";

export function ChoiceOptions({ options, selected = [], multiple = false, disabled = false, onChoose }: { options: Array<{ id: string; label: string; description?: string }>; selected?: string[]; multiple?: boolean; disabled?: boolean; onChoose: (id: string) => void }) {
  return <div className="wd-choice-options" role={multiple ? "group" : "radiogroup"}>{options.map(option => {
    const on = selected.includes(option.id);
    return <button type="button" key={option.id} className={`wd-choice-row${on ? " is-selected" : ""}`} role={multiple ? "checkbox" : "radio"} aria-checked={on} disabled={disabled} onClick={() => onChoose(option.id)}>
      <span className={`wd-choice-mark${multiple ? " is-multiple" : ""}`} aria-hidden="true">{on ? "✓" : null}</span>
      <span className="wd-choice-copy">{option.label}{option.description && <small>{option.description}</small>}</span>
    </button>;
  })}</div>;
}

export function ChoiceReceipt({ answers, pending = false }: { answers: Array<{ question: string; answer: string; choice?: boolean; selectedOptions?: Array<{ label: string }> }>; pending?: boolean }) {
  return <Receipts label={pending ? "Saving your choice" : "Your answers"}>{answers.map((item, index) => <Receipt key={index} icon={<ReceiptGlyph kind="answers" />} title={item.question} detail={item.selectedOptions?.length ? item.selectedOptions.map(option => option.label).join(", ") : item.answer} />)}</Receipts>;
}
