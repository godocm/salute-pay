"use client";
import { Brand } from "./brand";
import Link from "next/link";

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
    [method, setMethod] = useState<"wallet" | "transfer">("wallet"),
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
    queueMicrotask(() => {
      if (!alive) return;
      setIntent(null);
      setAccount("");
      setError("");
      setReceipt(null);
      setStatusWarning("");
      setCopied(false);
      setQr("");
    });
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
  const hasIntent = i !== null;
  useEffect(() => {
    if (slug === "offline" || !hasIntent) return;
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
  }, [slug, hasIntent]);
  async function pay() {
    if (
      !i ||
      busy ||
      paymentLock.current ||
      receipt?.status === "confirmed" ||
      receipt?.status === "pending"
    )
      return;
    const remaining = fundingProgress(
      i.received ?? i.balance,
      i.terms.amount,
    ).remaining;
    if (remaining <= 0n) return;
    paymentLock.current = true;
    setBusy(true);
    setError("");
    try {
      const hash = await act(
        configFor(i, configs),
        i,
        "deposit",
        value(remaining, i.decimals),
        setReceipt,
        account,
      );
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
        <Link className="checkout-brand" href="/">
          <Brand />
        </Link>
        <section className="checkout-card">
          <h1>{error ? "Unable to open payment" : "Verifying payment…"}</h1>
          <p role={error ? "alert" : "status"}>
            {error ||
              "Checking the merchant signature, network and deposit address."}
          </p>
          <Link className="button secondary" href="/">
            Return to Salute
          </Link>
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
  const complete = progress.remaining === 0n;
  const submitted =
    receipt?.status === "confirmed" || receipt?.status === "pending";
  async function updateStatus() {
    if (!i) return;
    setBusy(true);
    try {
      const next =
        slug === "offline" ? i : await api<Intent>(`payments/${slug}`);
      setIntent(
        await refresh(n, {
          ...i,
          received: next.received,
          collected: next.collected,
          settled: next.settled,
        }),
      );
      setStatusWarning("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="checkout checkout-simple">
      <header className="checkout-topbar">
        <Link className="checkout-brand" href="/">
          <Brand />
        </Link>
        <span className="checkout-beta">TESTNET · TEST ASSETS ONLY</span>
      </header>
      <section
        className="checkout-card compact-checkout"
        aria-label="Payment request"
      >
        <div className="checkout-head">
          <span className="merchant-avatar">
            {i.reference.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span className="eyebrow">PAYMENT REQUEST</span>
            <h1 title={i.reference}>{i.reference}</h1>
            <p>To {short(i.terms.merchant)}</p>
          </div>
          <ShieldCheck size={22} aria-label="Merchant signature verified" />
        </div>
        <div className="checkout-total">
          <small>Order amount · fixed</small>
          <strong>
            {expected} <span>{symbol}</span>
          </strong>
          <span className="checkout-network">
            {i.network.chain.toUpperCase()} ·{" "}
            {i.network.chainId === defaults[i.network.chain].chainId
              ? "TESTNET"
              : "LOCAL TEST"}
          </span>
        </div>
        <div className={`compact-status ${status}`} role="status">
          <span className="status-dot" />
          <div>
            <b>
              {complete
                ? cumulative
                  ? "Invoice funded"
                  : "Expected balance detected"
                : pendingAccounting
                  ? "Verifying received funds"
                  : status === "partially_paid"
                    ? "Partially paid"
                    : "Awaiting payment"}
            </b>
            <small>
              {complete
                ? `${value(i.received ?? i.balance, i.decimals)} ${symbol} ${cumulative ? "received" : "observed balance"}`
                : `${value(progress.remaining, i.decimals)} ${symbol} remaining`}
              {!cumulative && " · Live balance only"}
            </small>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh payment status"
            disabled={busy}
            onClick={updateStatus}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {!complete && !submitted && (
          <>
            <div
              className="checkout-tabs"
              role="group"
              aria-label="Payment method"
            >
              <button
                aria-pressed={method === "wallet"}
                onClick={() => setMethod("wallet")}
              >
                <Wallet size={16} /> Wallet
              </button>
              <button
                aria-pressed={method === "transfer"}
                onClick={() => setMethod("transfer")}
              >
                <Copy size={16} /> Transfer / QR
              </button>
            </div>
            {method === "wallet" ? (
              <section className="compact-wallet" aria-label="Pay with wallet">
                <p>
                  Connect a wallet to pay on <b>{i.network.chain}</b>.
                </p>
                <WalletControl
                  key={intentKey(i)}
                  disabled={busy}
                  network={n}
                  account={account}
                  onAccount={setAccount}
                  onError={setError}
                />
                <button
                  className="button primary wide"
                  disabled={busy || !account || pendingAccounting}
                  onClick={pay}
                >
                  {busy
                    ? "Confirm in your wallet…"
                    : `Pay ${value(progress.remaining, i.decimals)} ${symbol}`}
                  <ArrowUpRight size={17} />
                </button>
                <small>
                  Network fees are shown in your wallet before confirmation.
                </small>
              </section>
            ) : (
              <section
                className="compact-transfer"
                aria-label="Transfer payment"
              >
                {qr && (
                  <img
                    src={qr}
                    width={140}
                    height={140}
                    alt={`Payment address on ${i.network.chain}`}
                  />
                )}
                <div>
                  <p>
                    Send{" "}
                    <b>
                      {value(progress.remaining, i.decimals)} {symbol}
                    </b>{" "}
                    on <b>{i.network.chain}</b>.
                  </p>
                  <span className="eyebrow">PAYMENT ADDRESS</span>
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
                            "Select and copy the address; clipboard access is unavailable.",
                          );
                        }
                      }}
                    >
                      {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                  <small>
                    {copied
                      ? "Address copied"
                      : "Scan or copy the address. Verify the network."}
                  </small>
                </div>
              </section>
            )}
            <p className="compact-network-note">
              <AlertTriangle size={14} /> Use only {symbol} on {i.network.chain}
              . Other assets or networks may be unrecoverable.
            </p>
          </>
        )}
        {(complete || submitted) && (
          <div className="checkout-success">
            <CheckCircle2 size={32} />
            <h2>
              {complete
                ? cumulative
                  ? "Payment received"
                  : "Balance detected"
                : "Payment submitted"}
            </h2>
            <p>
              {complete
                ? cumulative
                  ? "Merchant collection is tracked separately from funding."
                  : "This offline link shows the current balance, not cumulative payment history."
                : "Keep your receipt. Receipt verification may take a moment; do not resend."}
            </p>
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
        {error && (
          <div role="alert" className="feedback error">
            {error}
          </div>
        )}
        {statusWarning && (
          <p className="feedback" role="status">
            {statusWarning}
          </p>
        )}
        {progress.excess > 0n && (
          <p className="field-note">
            {value(progress.excess, i.decimals)} {symbol} above the invoice.
            Excess funds go to the merchant; no automatic refund.
          </p>
        )}
        <p className="checkout-footnote">
          Non-custodial payment · Transfers cannot be reversed.
          {slug === "offline"
            ? " Offline link: cumulative history unavailable."
            : " Keep this link for your records."}
        </p>
      </section>
      <div className="checkout-footer">
        <ShieldCheck size={14} /> Merchant-signed order · Fixed destination
      </div>
    </main>
  );
}
