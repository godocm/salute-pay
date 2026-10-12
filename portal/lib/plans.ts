export type DashboardPlan = "free" | "growth" | "scale";
const evm = ["ethereum", "base", "arbitrum", "tempo", "bnb", "robinhood"];
export function planAllowsNetwork(plan: DashboardPlan, chain: string) {
  if (plan === "free") return ["ethereum", "base", "arbitrum"].includes(chain);
  if (plan === "growth") return evm.includes(chain);
  return plan === "scale" && [...evm, "solana", "tron"].includes(chain);
}
export function planNetworkMessage(chain: string) {
  return chain === "solana" || chain === "tron"
    ? "Solana and TRON dashboard links require the $99 Scale plan. Contract access remains open."
    : "This EVM dashboard network requires Growth ($49) or Scale ($99). Free includes Ethereum, Base and Arbitrum.";
}
