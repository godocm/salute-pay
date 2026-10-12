export type FundingStatus = "awaiting" | "partially_paid" | "paid" | "overpaid";

export const fundingLabels: Record<FundingStatus, string> = {
  awaiting: "Awaiting payment",
  partially_paid: "Underpaid",
  paid: "Fully paid",
  overpaid: "Overpaid",
};

export function cumulativeReceived(i: {
  balance: string;
  collected?: string;
  received?: string;
}) {
  // Only the server index supplies cumulative receipt history. A live balance
  // and cached sweep estimates cannot establish how much arrived in past sweeps.
  return BigInt(i.received ?? i.balance);
}

// A balance is current funding evidence, while invoice history comes from receipts.
// Never add a browser's cached sweep estimate to either figure.
export function fundingView(i: { balance: string; received?: string }, expected: string) {
  const live = BigInt(i.balance),
    recorded = i.received === undefined ? null : BigInt(i.received),
    fromBalance = recorded === null || live > recorded,
    progress = fundingProgress(fromBalance ? live : recorded, expected);
  return {
    ...progress,
    fromBalance,
    label: fromBalance
      ? { awaiting: "No balance", partially_paid: "Underpaid balance", paid: "Fully funded balance", overpaid: "Overpaid balance" }[progress.status]
      : fundingLabels[progress.status],
  };
}

// Use gross, cumulative invoice-asset receipts, not the remaining vault balance.
export function fundingStatus(
  received: string | bigint,
  expected: string | bigint,
): FundingStatus {
  const total = BigInt(received),
    invoice = BigInt(expected);
  return total > invoice
    ? "overpaid"
    : total === invoice && total > 0n
      ? "paid"
      : total > 0n
        ? "partially_paid"
        : "awaiting";
}

export function fundingProgress(
  received: string | bigint,
  expected: string | bigint,
) {
  const total = BigInt(received),
    invoice = BigInt(expected);
  return {
    status: fundingStatus(total, invoice),
    remaining: invoice > total ? invoice - total : 0n,
    excess: total > invoice ? total - invoice : 0n,
  };
}
