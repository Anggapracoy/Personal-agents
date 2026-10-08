import { SourceIcon } from "./source-icon";

const networks: Record<string, string> = {
  visa: "visa", mastercard: "mastercard", amex: "amex", americanexpress: "amex", discover: "discover",
};

/** Network artwork only when the saved, non-secret brand is recognized. */
export function PaymentCardIcon({ brand }: { brand?: string | null }) {
  const network = networks[(brand ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "")];
  return network
    ? <img className="wd-source-icon wd-card-network" src={`/card-networks/${network}.svg`} width={30} height={30} alt="" aria-hidden="true" />
    : <SourceIcon name="payment_card" />;
}
