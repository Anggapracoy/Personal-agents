export function CheckoutIcon() {
  return <svg className="wd-checkout-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h2l2.4 12h11.8l2-9H6M8 15l-1 3h12" /><circle cx="9" cy="21" r="1" /><circle cx="18" cy="21" r="1" /></svg>;
}

export function FinancialApprovalIcon({ type }: { type: "purchase" | "bill_payment" | "transfer" | "payment" }) {
  if (type === "purchase") return <CheckoutIcon />;
  return <svg className="wd-checkout-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === "bill_payment" ? <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M8 8h8M8 12h8" /></>
      : type === "transfer" ? <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>
      : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>}
  </svg>;
}
