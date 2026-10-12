import type { Chain } from "./intents";

function read(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}
export function walletConnector(family: string) {
  return read(`salute.wallet.connector.${family}`) || "";
}
export function rememberWalletConnector(family: string, connector: string) {
  write(`salute.wallet.connector.${family}`, connector);
}
export function readWorkspaceWallet(chains: readonly Chain[]) {
  try {
    const saved = JSON.parse(read("salute.workspace.wallet.v1") || "null");
    if (
      !saved ||
      !chains.includes(saved.chain) ||
      typeof saved.connected !== "boolean"
    )
      return null;
    return saved as { chain: Chain; connected: boolean };
  } catch {
    return null;
  }
}
export function storeWorkspaceWallet(chain: Chain, connected: boolean) {
  write("salute.workspace.wallet.v1", JSON.stringify({ chain, connected }));
}
