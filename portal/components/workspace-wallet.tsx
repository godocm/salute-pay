"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  chains,
  defaults,
  isEvm,
  restoreWallet,
  watchEvmWallet,
  type Chain,
} from "../lib/intents";
import { watchWalletAccounts } from "../lib/wallet-connectors";
import {
  readWorkspaceWallet,
  storeWorkspaceWallet,
} from "../lib/wallet-session";

const WalletContext = createContext<{
  chain: Chain;
  account: string;
  restoring: boolean;
  setChain: (chain: Chain) => void;
  setAccount: (account: string) => void;
} | null>(null);

export function WorkspaceWalletProvider({ children }: { children: ReactNode }) {
  const [chain, updateChain] = useState<Chain>("tempo");
  const [account, updateAccount] = useState("");
  const [restoring, setRestoring] = useState(true);
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const saved = readWorkspaceWallet(chains);
    const requested =
      location.pathname === "/app"
        ? new URLSearchParams(location.search).get("chain")
        : null;
    const next =
      requested && chains.includes(requested as Chain)
        ? (requested as Chain)
        : saved?.chain || "tempo";
    updateChain(next);
    const generation = revision.current;
    const sameFamily =
      saved && (saved.chain === next || (isEvm(saved.chain) && isEvm(next)));
    async function restore() {
      if (!saved?.connected || !sameFamily) return;
      // Extensions may announce themselves shortly after page initialization.
      for (
        let attempt = 0;
        attempt < 6 && alive && generation === revision.current;
        attempt++
      ) {
        try {
          const restored = await restoreWallet(defaults[next]);
          if (restored) {
            if (alive && generation === revision.current)
              updateAccount(restored);
            return;
          }
        } catch {
          /* An unavailable or revoked wallet remains disconnected. */
        }
        if (attempt < 5)
          await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    restore().finally(() => {
      if (alive) setRestoring(false);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!restoring) storeWorkspaceWallet(chain, Boolean(account));
  }, [chain, account, restoring]);
  function setAccount(next: string) {
    revision.current++;
    updateAccount(next);
  }
  useEffect(() => {
    if (!account) return;
    return isEvm(chain)
      ? watchEvmWallet(setAccount)
      : watchWalletAccounts(chain, setAccount);
  }, [chain, account]);
  function setChain(next: Chain) {
    revision.current++;
    if (next !== chain && !(isEvm(next) && isEvm(chain))) setAccount("");
    updateChain(next);
  }
  return (
    <WalletContext.Provider
      value={{ chain, account, restoring, setChain, setAccount }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWorkspaceWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw Error("Workspace wallet provider is missing.");
  return wallet;
}
