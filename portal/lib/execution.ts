import type { Intent, Chain } from "./intents";

export function collectionStatus(i: Intent) {
  if (i.receipts.some((r) => r.kind === "settle" && r.status === "pending"))
    return { status: "pending", label: "Confirming" };
  if (BigInt(i.balance) > 0n)
    return BigInt(i.balance) > BigInt(i.terms.executorFee)
      ? { status: "ready", label: "Ready to execute" }
      : { status: "sponsor", label: "Sponsorship needed" };
  return i.settled || BigInt(i.collected ?? "0") > 0n
    ? { status: "collected", label: "Collected" }
    : { status: "awaiting", label: "Waiting for funds" };
}

// EVM addresses are case-insensitive; Solana and TRON Base58 addresses are not.
export function sameWallet(chain: Chain, left: string, right: string) {
  if (!left || !right) return false;
  return chain === "solana" || chain === "tron"
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

export function executionPreview(i: Intent, account: string, waive: boolean) {
  const balance = BigInt(i.balance),
    self = sameWallet(i.network.chain, account, i.terms.merchant),
    reward = waive || self ? 0n : BigInt(i.terms.executorFee),
    pending = i.receipts.some(
      (r) => r.kind === "settle" && r.status === "pending",
    );
  return {
    balance,
    self,
    reward,
    merchantAmount: balance > reward ? balance - reward : 0n,
    pending,
    collectible: balance > reward && !pending,
  };
}

// Successful chain execution stays successful when the optional index is down.
export async function afterConfirmation<T>(
  current: T,
  report: () => Promise<unknown>,
  refresh: () => Promise<T>,
) {
  const results = await Promise.allSettled([report(), refresh()]);
  return {
    current: results[1].status === "fulfilled" ? results[1].value : current,
    warning: [
      results[0].status === "rejected"
        ? "The status service could not record the receipt yet."
        : "",
      results[1].status === "rejected"
        ? "The chain balance could not be refreshed yet."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
