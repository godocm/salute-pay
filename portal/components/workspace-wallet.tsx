"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isEvm, watchEvmWallet, type Chain } from "../lib/intents";
import { watchWalletAccounts } from "../lib/wallet-connectors";

const WalletContext = createContext<{
  chain: Chain;
  account: string;
  setChain: (chain: Chain) => void;
  setAccount: (account: string) => void;
} | null>(null);

export function WorkspaceWalletProvider({ children }: { children: ReactNode }) {
  const [chain, updateChain] = useState<Chain>("tempo");
  const [account, setAccount] = useState("");
  useEffect(() => {
    if (!account) return;
    return isEvm(chain)
      ? watchEvmWallet(setAccount)
      : watchWalletAccounts(chain, setAccount);
  }, [chain, account]);
  function setChain(next: Chain) {
    if (next !== chain && !(isEvm(next) && isEvm(chain))) setAccount("");
    updateChain(next);
  }
  return (
    <WalletContext.Provider value={{ chain, account, setChain, setAccount }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWorkspaceWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw Error("Workspace wallet provider is missing.");
  return wallet;
}
