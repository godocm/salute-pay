"use client";
import { useEffect, useState } from "react";
import {
  chains,
  defaults,
  isEvm,
  wallets,
  chooseWallet,
  connect,
  short,
  disconnectWallet,
  walletOptions,
  watchEvmWallet,
  type Network,
} from "../lib/intents";
import { selectSolana } from "../lib/wallet-connectors";
export function WalletControl({
  network,
  account,
  onAccount,
  onError,
  disabled = false,
}: {
  network: Network;
  account: string;
  onAccount: (s: string) => void;
  onError: (s: string) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    onAccount("");
    setSelected("");
    if (isEvm(network.chain))
      wallets().then(
        (x) =>
          alive &&
          setOptions([
            { id: "injected", name: "Browser wallet" },
            ...x,
            ...(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
              ? [{ id: "walletconnect", name: "WalletConnect · mobile / QR" }]
              : []),
          ]),
      );
    else
      walletOptions(network.chain).then(
        (options) => alive && setOptions(options),
      );
    return () => {
      alive = false;
    };
  }, [network.chain]);
  useEffect(() => {
    if (!account || !isEvm(network.chain)) return;
    return watchEvmWallet(() => onAccount(""));
  }, [account, network.chain]);
  async function toggle() {
    setBusy(true);
    try {
      if (account) {
        await disconnectWallet();
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        onAccount("");
      } else {
        if (isEvm(network.chain)) chooseWallet(selected);
        else if (network.chain === "solana") selectSolana(selected);
        onAccount(await connect(network));
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wallet-control">
      {!account && (
        <select
          disabled={busy || disabled}
          aria-label="Wallet connector"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose wallet</option>
          {options.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <button
        className="button secondary"
        disabled={busy || disabled}
        onClick={toggle}
      >
        {busy
          ? "Connecting…"
          : account
            ? `${short(account)} · Disconnect`
            : "Connect wallet"}
      </button>
    </div>
  );
}
