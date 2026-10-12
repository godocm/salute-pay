export type DashboardPlan = "free" | "growth" | "scale";
const evm = ["ethereum", "base", "arbitrum", "tempo", "bnb", "robinhood"];
const testnetIds: Record<string, string[]> = {
  ethereum: ["11155111"],
  base: ["84532"],
  arbitrum: ["421614"],
  tempo: ["42431"],
  bnb: ["97"],
  robinhood: ["46630"],
  solana: ["devnet"],
  tron: ["3448148188", "2494104990"],
};
export function isBetaNetwork(network: {
  chain: string;
  chainId: string;
  environment?: string;
}) {
  return (
    network.environment === "testnet" &&
    Boolean(testnetIds[network.chain]?.includes(network.chainId))
  );
}
export function planAllowsNetwork(
  plan: DashboardPlan,
  chain: string,
  beta = false,
) {
  if (beta) return [...evm, "solana", "tron"].includes(chain);
  if (plan === "free") return ["ethereum", "base", "arbitrum"].includes(chain);
  if (plan === "growth") return evm.includes(chain);
  return plan === "scale" && [...evm, "solana", "tron"].includes(chain);
}
export function planPaymentLimit(plan: DashboardPlan, beta = false) {
  return beta
    ? Infinity
    : plan === "free"
      ? 20
      : plan === "growth"
        ? 1000
        : Infinity;
}
export function planNetworkMessage(chain: string) {
  return chain === "solana" || chain === "tron"
    ? "Solana and TRON dashboard links require the $99 Scale plan. Contract access remains open."
    : "This EVM dashboard network requires Growth ($49) or Scale ($99). Free includes Ethereum, Base and Arbitrum.";
}
