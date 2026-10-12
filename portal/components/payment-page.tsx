"use client";
import { Brand } from "./brand";

import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import { fundingProgress } from "../lib/payment-status";
import {
  Copy,
  ShieldCheck,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { WalletControl } from "./wallet-control";
import { api, submitTransaction } from "../lib/platform";
import {
  defaults,
  configFor,
  parseLink,
  verify,
  refresh,
  act,
  value,
  short,
  explorer,
  type Intent,
  type Network,
  type Chain,
  type Receipt,
  intentKey,
} from "../lib/intents";
export default function PaymentPage({ slug }: { slug: string }) {
  const paymentLock = useRef(false);
  const [i, setIntent] = useState<Intent | null>(null),
    [configs, setConfigs] = useState<Record<Chain, Network>>(defaults),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [account, setAccount] = useState(""),
    [amount, setAmount] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [copied, setCopied] = useState(false),
    [statusWarning, setStatusWarning] = useState(""),
    [linkRevision, setLinkRevision] = useState(0);
  useEffect(() => {
    const changed = () => setLinkRevision((revision) => revision + 1);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    let alive = true;
    setIntent(null);
    setAccount("");
    setError("");
    setReceipt(null);
    setStatusWarning("");
    setCopied(false);
    setQr("");
    setAmount("");
    async function load() {
      try {
        const deployment = await api<{ networks: Record<string, Network> }>(
            "networks",
          ),
          networks = { ...defaults, ...deployment.networks };
        if (alive) setConfigs(networks);
        const intent =
          slug === "offline"
            ? parseLink(location.href)
            : await api<Intent & { status: string }>(`payments/${slug}`);
        await verify(configFor(intent, networks), intent);
        const current = await refresh(configFor(intent, networks), intent);
        if (alive) {
          setIntent(current);
          const remaining = fundingProgress(
            current.received ?? "0",
            intent.terms.amount,
          ).remaining;
          setAmount(
            slug === "offline"
              ? value(intent.terms.amount, intent.decimals)
              : remaining > 0n
                ? value(remaining, intent.decimals)
                : "",
          );
          const image = await QRCode.toDataURL(intent.address, {
            width: 240,
            margin: 2,
            color: { dark: "#102f5e", light: "#ffffff" },
          });
          if (alive) setQr(image);
        }
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Payment could not be verified.",
          );
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [slug, linkRevision]);
  useEffect(() => {
    if (slug === "offline" || !i) return;
    const id = setInterval(
      () =>
        api<Intent & { status: string }>(`payments/${slug}`)
          .then((next) => {
            setIntent((previous) =>
              previous
                ? {
                    ...previous,
                    received: next.received,
                    collected: next.collected,
                    balance: next.balance,
                    settled: next.settled,
                  }
                : previous,
            );
            setStatusWarning("");
          })
          .catch(() =>
            setStatusWarning(
              "Status updates are temporarily unavailable. Showing the last verified record.",
            ),
          ),
      15000,
    );
    return () => clearInterval(id);
  }, [slug, Boolean(i)]);
  async function pay() {
    if (!i || busy || paymentLock.current) return;
    paymentLock.current = true;
    setBusy(true);
    setError("");
    try {
      const hash = await act(
        configFor(i, configs),
        i,
        "deposit",
        amount,
        setReceipt,
        account,
      );
      setAmount("");
      try {
        setIntent(await refresh(configFor(i, configs), i));
      } catch {
        setStatusWarning(
          "Transaction confirmed. Balance refresh is temporarily unavailable; keep your receipt.",
        );
      }
      try {
        await submitTransaction(i, i.network.chain, hash);
      } catch {
        setStatusWarning(
          "Your transaction was sent. The status service could not record it yet; keep the transaction receipt and do not resend just to update the dashboard.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      paymentLock.current = false;
      setBusy(false);
    }
  }
  if (!i)
    return (
      <main className="checkout">
        <a className="checkout-brand" href="/">
          <Brand />
        </a>
        <section className="checkout-card">
          <h1>{error ? "Unable to open payment" : "Verifying payment…"}</h1>
          <p role={error ? "alert" : "status"}>
            {error ||
              "Checking the merchant signature, network and deposit address."}
          </p>
          <a className="button secondary" href="/">
            Return to Salute
          </a>
        </section>
      </main>
    );
  const n = configFor(i, configs),
    expected = value(i.terms.amount, i.decimals),
    symbol = i.asset,
    cumulative = i.received !== undefined,
    progress = fundingProgress(i.received ?? i.balance, i.terms.amount),
    status = progress.status,
    pendingAccounting =
      cumulative &&
      BigInt(i.balance) + BigInt(i.collected ?? "0") >
        BigInt(i.received ?? "0");
  return (
    <main className="checkout">
      <a className="checkout-brand" href="/">
        <Brand />
      </a>
      <span className="checkout-beta">BETA · TESTNET · TEST ASSETS ONLY</span>
      <section className="checkout-card">
        <div className="checkout-head">
          <span className="merchant-avatar">
            {i.reference.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span className="eyebrow">PAYMENT REQUEST</span>
            <h1>{i.reference}</h1>
            <p>To merchant {short(i.terms.merchant)}</p>
          </div>
          <ShieldCheck size={24} />
        </div>
        <div className="checkout-total">
          <small>Invoice amount</small>
          <strong>
            {expected} <span>{symbol}</span>
          </strong>
          <span className="checkout-network">
            {i.network.chain.toUpperCase()} ·{" "}
            {i.network.chainId === defaults[i.network.chain].chainId
              ? "TESTNET"
              : "LOCAL TEST ENVIRONMENT"}
          </span>
        </div>
        <div className="network-warning">
          <AlertTriangle size={20} />
          <p>
            Send only <b>{symbol}</b> on <b>{i.network.chain}</b> to this
            address. Do not select another network in your exchange or wallet.
            Wrong-network recovery is limited and is not guaranteed.
          </p>
        </div>
        <section
          className="wallet-payment"
          aria-labelledby="wallet-payment-title"
        >
          <h2 id="wallet-payment-title">
            <Wallet size={17} />
            Pay with a connected wallet
          </h2>
          <p className="field-note">
            Wallet connection is optional. You can also copy the payment address
            below and send a transfer.{" "}
            {n.chain === "solana"
              ? "Use Phantom, Solflare or another installed Wallet Standard wallet. Select Devnet in your wallet."
              : n.chain === "tron"
                ? "Use the TronLink adapter and select Nile testnet."
                : "Use a browser wallet or WalletConnect with a compatible testnet wallet."}
          </p>
          <WalletControl
            key={intentKey(i)}
            disabled={busy}
            network={n}
            account={account}
            onAccount={setAccount}
            onError={setError}
          />
          <label>
            Amount to send ({symbol})
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <p className="field-note">
            The invoice requests {expected} {symbol}. A smaller payment remains
            partial; an excess payment goes to the merchant. Exchange fees can
            reduce the received amount.{" "}
            {i.network.chain === "solana" && i.asset === "SOL"
              ? "A new SOL address needs a rent-exempt first balance; ask the merchant to prepare it for tiny deposits."
              : ""}
          </p>
          <button
            className="button primary wide"
            disabled={busy || !account || !amount}
            onClick={pay}
          >
            {busy ? "Waiting for confirmation…" : "Review in wallet & pay"}
            <ArrowUpRight size={17} />
          </button>
        </section>
        <div className="checkout-method-divider">
          <span>Or transfer from a wallet or exchange</span>
        </div>
        <div className="checkout-payment">
          <div className="qr-box">
            {qr && (
              <img
                src={qr}
                width={224}
                height={224}
                alt={`${symbol} payment address QR code on ${i.network.chain}`}
              />
            )}
            <small>Scan the address · verify the network</small>
          </div>
          <div className="checkout-instructions">
            <h2>Pay from a wallet or exchange</h2>
            <p>
              Copy the address below into your withdrawal or transfer. No wallet
              connection to Salute is needed. Confirm the matching testnet and
              asset; commercial exchanges typically do not support these test
              assets.
            </p>
            <label>
              Unique payment address
              <div className="copy-field">
                <code>{i.address}</code>
                <button
                  aria-label="Copy payment address"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(i.address);
                      setCopied(true);
                    } catch {
                      setError(
                        "Could not access clipboard. Select and copy the address.",
                      );
                    }
                  }}
                >
                  {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </label>
            <dl>
              <div>
                <dt>Required network</dt>
                <dd>
                  {i.network.chain} · ID {i.network.chainId}
                </dd>
              </div>
              <div>
                <dt>Asset / token</dt>
                <dd>{symbol}</dd>
              </div>
              <div>
                <dt>Merchant destination</dt>
                <dd>
                  <code>{i.terms.merchant}</code>
                </dd>
              </div>
              {i.terms.token !== "0x0000000000000000000000000000000000000000" &&
                i.terms.token !== "11111111111111111111111111111111" &&
                i.asset !== "TRX" && (
                  <div>
                    <dt>
                      {n.chain === "solana" ? "Token mint" : "Token contract"}
                    </dt>
                    <dd>
                      <code>{i.terms.token}</code>
                    </dd>
                  </div>
                )}
            </dl>
          </div>
        </div>
        {error && (
          <div role="alert" className="feedback error">
            {error}
          </div>
        )}
        {receipt && (
          <div className="receipt">
            <span>
              {receipt.kind} · {receipt.status}
            </span>
            {explorer(n, receipt.hash) ? (
              <a
                target="_blank"
                rel="noreferrer"
                href={explorer(n, receipt.hash)}
              >
                View transaction ↗
              </a>
            ) : (
              <code>{short(receipt.hash)}</code>
            )}
          </div>
        )}
        <div className={`payment-status ${status}`}>
          <span className="status-dot" />
          <div>
            <b>
              {status === "overpaid"
                ? cumulative
                  ? "Overpayment received"
                  : "Excess balance detected"
                : status === "paid"
                  ? cumulative
                    ? "Invoice funded"
                    : "Expected balance detected"
                  : status === "partially_paid"
                    ? cumulative
                      ? "Partial payment received"
                      : "Partial balance detected"
                    : cumulative
                      ? pendingAccounting
                        ? "Funds detected · Verifying"
                        : "Awaiting payment"
                      : "No balance awaiting collection"}
            </b>
            <dl className="checkout-progress">
              <div>
                <dt>{cumulative ? "Total received" : "Collectable balance"}</dt>
                <dd>
                  {value(i.received ?? i.balance, i.decimals)} {symbol}
                </dd>
              </div>
              {progress.remaining > 0n && (
                <div>
                  <dt>Remaining {cumulative ? "to fund" : "versus invoice"}</dt>
                  <dd>
                    {value(progress.remaining, i.decimals)} {symbol}
                  </dd>
                </div>
              )}
              {progress.excess > 0n && (
                <div>
                  <dt>Above invoice amount</dt>
                  <dd>
                    {value(progress.excess, i.decimals)} {symbol}
                  </dd>
                </div>
              )}
              {cumulative && (
                <div>
                  <dt>Gross collected</dt>
                  <dd>
                    {value(i.collected ?? "0", i.decimals)} {symbol}
                  </dd>
                </div>
              )}
            </dl>
            <p>
              {pendingAccounting &&
                "A new balance is detected; waiting for server receipt verification. "}
              {cumulative
                ? "Confirmed funding and merchant collection are separate. Collection may deduct the merchant-authorized executor reward."
                : "This offline link shows the current chain balance, not cumulative payment history."}{" "}
              {progress.excess > 0n
                ? "Excess funds remain collectable to the merchant; there is no automatic refund."
                : progress.remaining > 0n && cumulative
                  ? "Send only the remaining amount to top up this invoice."
                  : ""}
            </p>
          </div>
          <button
            aria-label="Refresh payment status"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (slug !== "offline") {
                  const next = await api<Intent & { status: string }>(
                    `payments/${slug}`,
                  );
                  setIntent(
                    await refresh(n, {
                      ...i,
                      received: next.received,
                      collected: next.collected,
                      settled: next.settled,
                    }),
                  );
                } else {
                  setIntent(await refresh(n, i));
                }
                setStatusWarning("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Refresh failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {statusWarning && (
          <p className="feedback" role="status">
            {statusWarning}
          </p>
        )}
        <p className="checkout-footnote">
          Payments are non-custodial. Salute cannot reverse a transfer. Contact
          the merchant about refunds.{" "}
          {slug === "offline"
            ? "This is an exported offline link; server status and webhooks are unavailable."
            : "Keep this link to check your payment."}
        </p>
      </section>
      <div className="checkout-footer">
        <ShieldCheck size={14} />
        Merchant-signed order · Funds forwarded directly to the merchant
      </div>
    </main>
  );
}
