"use client";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { Network } from "./intents";
import evmNetworks from "./evm-networks.json";
import { rememberWalletConnector } from "./wallet-session";

type EipProvider = {
  request(args: {
    method: string;
    params?: unknown[] | object;
  }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: () => void): void;
  disconnect?(): Promise<void>;
};
let wc: EipProvider | undefined,
  sol: Wallet | undefined,
  solAccount: WalletAccount | undefined,
  solName = "",
  tron:
    import("@tronweb3/tronwallet-adapter-tronlink").TronLinkAdapter | undefined;
export function selectSolana(name: string) {
  solName = name;
  sol = undefined;
  solAccount = undefined;
}
export async function walletOptions(chain: string) {
  if (chain === "solana")
    return getWallets()
      .get()
      .filter(
        (w) =>
          w.features["standard:connect"] &&
          w.features["solana:signMessage"] &&
          w.features["solana:signTransaction"],
      )
      .map((w) => ({ id: w.name, name: w.name }));
  if (chain === "tron") return [{ id: "tronlink", name: "TronLink" }];
  return [];
}
function feature<T>(w: Wallet, name: string): T {
  const f = w.features[name as `${string}:${string}`];
  if (!f) throw Error(`Wallet lacks ${name}.`);
  return f as T;
}
export async function connectSolana(silent = false) {
  const candidates = getWallets()
    .get()
    .filter(
      (w) =>
        w.features["standard:connect"] &&
        w.features["solana:signMessage"] &&
        w.features["solana:signTransaction"],
    );
  sol = sol || candidates.find((w) => w.name === solName) || (!silent ? candidates[0] : undefined);
  if (!sol)
    throw Error(
      "Open this page in Phantom/Solflare, or install a Solana Wallet Standard wallet.",
    );
  const result = await feature<{
    connect: (input?: { silent: boolean }) => Promise<{ accounts: WalletAccount[] }>;
  }>(sol, "standard:connect").connect(silent ? { silent: true } : undefined);
  solAccount = result.accounts.find((a) =>
    a.chains.some((c) => c.startsWith("solana:")),
  );
  if (!solAccount) throw Error("No Solana account was authorized.");
  rememberWalletConnector("solana", sol.name);
  return currentSolana();
}
export function currentSolana() {
  if (!sol || !solAccount) throw Error("Connect a Solana wallet first.");
  const wallet = sol,
    account = solAccount;
  return {
    publicKey: new PublicKey(account.publicKey),
    connect: async () => {},
    signMessage: async (message: Uint8Array) => {
      const [result] = await feature<{
        signMessage: (i: {
          account: WalletAccount;
          message: Uint8Array;
        }) => Promise<{ signature: Uint8Array }[]>;
      }>(wallet, "solana:signMessage").signMessage({ account, message });
      return result.signature;
    },
    signTransaction: async (tx: Transaction) => {
      const [result] = await feature<{
        signTransaction: (i: {
          account: WalletAccount;
          transaction: Uint8Array;
          chain: string;
        }) => Promise<{ signedTransaction: Uint8Array }[]>;
      }>(wallet, "solana:signTransaction").signTransaction({
        account,
        transaction: tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
        chain: solanaChain,
      });
      return Transaction.from(result.signedTransaction);
    },
    disconnect: async () => {
      if (wallet.features["standard:disconnect"])
        await feature<{ disconnect: () => Promise<void> }>(
          wallet,
          "standard:disconnect",
        ).disconnect();
      sol = undefined;
      solAccount = undefined;
    },
  };
}
let solanaChain = "solana:devnet";
export function setSolanaChain(chainId: string) {
  solanaChain = chainId === "localnet" ? "solana:localnet" : "solana:devnet";
}
export async function connectTron(chainId: string) {
  if (!tron) {
    const { TronLinkAdapter } =
      await import("@tronweb3/tronwallet-adapter-tronlink");
    tron = new TronLinkAdapter({
      dappName: "Salute Pay",
      dappIcon: `${location.origin}/favicon.svg`,
    });
  }
  await tron.connect();
  if (chainId !== "local")
    await tron.switchChain("0x" + BigInt(chainId).toString(16));
  return tron.address!;
}
export async function walletConnectProvider(n: Network, allowNewSession = true): Promise<EipProvider> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId)
    throw Error(
      "WalletConnect needs a project ID. Use an installed wallet or configure NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.",
    );
  if (!wc) {
    const { EthereumProvider } =
      await import("@walletconnect/ethereum-provider");
    wc = await EthereumProvider.init({
      projectId,
      showQrModal: true,
      optionalChains: [
        Number(n.chainId),
        ...Object.values(evmNetworks)
          .map((c) => Number(c.chainId))
          .filter((id) => id !== Number(n.chainId)),
      ] as [number, ...number[]],
      rpcMap: {
        ...Object.fromEntries(
          Object.values(evmNetworks).map((c) => [Number(c.chainId), c.rpc]),
        ),
        [Number(n.chainId)]: n.rpc,
      },
      metadata: {
        name: "Salute Pay",
        description: "Non-custodial merchant payments",
        url: location.origin,
        icons: [`${location.origin}/favicon.svg`],
      },
    });
  }
  const provider = wc as EipProvider & {
    session?: unknown;
    connect: () => Promise<unknown>;
  };
  if (!provider.session) {
    if (!allowNewSession) throw Error("No existing WalletConnect session.");
    await provider.connect();
  }
  return wc;
}
export function activeWalletConnectProvider() {
  return wc;
}
export async function restoreTron() {
  const injected = (window as unknown as { tronWeb?: { ready?: boolean; defaultAddress?: { base58?: string } } }).tronWeb;
  if (!injected?.ready || !injected.defaultAddress?.base58) return "";
  if (!tron) {
    const { TronLinkAdapter } = await import("@tronweb3/tronwallet-adapter-tronlink");
    tron = new TronLinkAdapter({ dappName: "Salute Pay", dappIcon: `${location.origin}/favicon.svg` });
  }
  // network() checks the already authorized adapter without connecting or switching.
  await tron.network();
  return tron.address || "";
}
export function watchWalletAccounts(chain: string, changed: (account: string) => void) {
  if (chain === "solana" && sol) {
    const wallet = sol;
    if (!wallet.features["standard:events"]) return;
    return feature<{
      on: (event: "change", listener: (properties: { accounts?: readonly WalletAccount[] }) => void) => () => void;
    }>(wallet, "standard:events").on("change", ({ accounts }) => {
      if (!accounts) return;
      solAccount = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
      changed(solAccount?.address || "");
    });
  }
  if (chain === "tron" && tron) {
    const adapter = tron;
    const listener = (address: string) => changed(address || "");
    adapter.on("accountsChanged", listener);
    return () => { adapter.off("accountsChanged", listener); };
  }
}
export async function disconnectWallet() {
  await wc?.disconnect?.();
  wc = undefined;
  if (sol && solAccount) await currentSolana().disconnect();
  await tron?.disconnect();
  tron = undefined;
}
