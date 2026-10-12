import evm from "../lib/evm-networks.json";
import registry from "../public/deployments/main.json";
export type PublishedNetwork = {
  chain: string;
  chainId: string;
  deployment: string;
  token: string;
  domain: string;
  rpc: string;
  feeToken?: string;
  faucet?: string;
  confirmations: number;
  status: string;
  environment: string;
};
export function networks(): Record<string, PublishedNetwork> {
  const records =
    (process.env.SALUTE_NETWORKS_JSON
      ? JSON.parse(process.env.SALUTE_NETWORKS_JSON)
      : registry
    ).networks || {};
  const result: Record<string, PublishedNetwork> = {};
  for (const [chain, r] of Object.entries(records) as [
    string,
    PublishedNetwork,
  ][]) {
    if (!Object.hasOwn(evm, chain) && chain !== "solana" && chain !== "tron")
      continue;
    if (!r.deployment || r.status !== "ready") continue;
    const config = evm[chain as keyof typeof evm];
    const rpc =
      process.env[`RPC_${chain.toUpperCase()}`] ||
      r.rpc ||
      config?.rpc ||
      (chain === "solana"
        ? "https://api.devnet.solana.com"
        : "https://nile.trongrid.io");
    const u = new URL(rpc),
      local = ["127.0.0.1", "localhost"].includes(u.hostname);
    if (
      (local && process.env.ALLOW_LOCAL_RPC !== "true") ||
      (!local && u.protocol !== "https:")
    )
      continue;
    result[chain] = {
      ...r,
      chain,
      rpc,
      confirmations: Math.max(1, r.confirmations || 2),
    };
  }
  return result;
}
export function publicNetworks() {
  return Object.fromEntries(
    Object.entries(networks()).map(([chain, n]) => [
      chain,
      {
        ...n,
        rpc: n.rpc.startsWith("http://127.0.0.1")
          ? n.rpc
          : evm[chain as keyof typeof evm]?.rpc ||
            (chain === "solana"
              ? "https://api.devnet.solana.com"
              : "https://nile.trongrid.io"),
      },
    ]),
  );
}
