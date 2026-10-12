"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  LockKeyhole,
  Zap,
} from "lucide-react";
import { ChainLogo } from "./brand";
import { chainPages } from "../lib/chain-pages";

const nativeAsset: Record<string, string> = {
  ethereum: "ETH",
  base: "ETH",
  arbitrum: "ETH",
  bnb: "BNB",
  robinhood: "ETH",
  solana: "SOL",
  tron: "TRX",
};

export function PaymentHero() {
  const [network, setNetwork] = useState("tempo"),
    [deposit, setDeposit] = useState(100),
    [native, setNative] = useState(false),
    [sponsored, setSponsored] = useState(false);
  const chain = chainPages.find((item) => item.id === network)!,
    symbol = native ? nativeAsset[network] : "sUSD",
    reward = sponsored ? 0 : 2,
    status =
      deposit < 100 ? "Partial" : deposit > 100 ? "Overpaid" : "Exact amount";
  return (
    <section className="bank-hero" aria-labelledby="payment-hero-title">
      <div className="bank-hero-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="section-width bank-hero-grid">
        <div className="bank-hero-copy">
          <div className="bank-kicker">
            <span /> BY SALUTE BANK · OPEN TO EVERYONE
          </div>
          <h1 id="payment-hero-title">
            <span className="hero-fee-line">
              No custody.
              <br />
              No fees.
              <br />
              No wallet pairing.
            </span>
          </h1>
          <div className="hero-fee-note">
            0% Salute collection fee. Network costs and optional executor
            rewards still apply.
          </div>
          <p className="hero-description">
            <strong>Onchain payments across eight chains.</strong>
            <span>Anyone can create an order. Anyone can settle it.</span>
            <span>
              Customers can pay by transfer without connecting a wallet.
            </span>
            <span>Your signature keeps the payout in your control.</span>
          </p>
          <div className="bank-hero-actions">
            <Link href="/app" className="bank-primary">
              Launch app{" "}
              <span>
                <ArrowUpRight size={21} />
              </span>
            </Link>
            <Link href="/docs" className="bank-secondary">
              Build with Salute <ArrowRight size={16} />
            </Link>
          </div>
          <div className="bank-hero-values">
            <span>
              <b>8</b> chains
            </span>
            <span>
              <LockKeyhole size={16} /> Non-custodial
            </span>
            <span>
              <Zap size={16} /> Open execution
            </span>
          </div>
          <Link href="/docs#deployments" className="bank-beta">
            <i /> Beta · Public testnets · Test assets only{" "}
            <ArrowUpRight size={12} />
          </Link>
        </div>
        <div
          className="checkout-simulator"
          role="region"
          aria-label="Illustrative payment calculator"
        >
          <div className="demo-window-head">
            <span className="demo-window-dots">
              <i />
              <i />
              <i />
            </span>
            <span>Payment example</span>
            <span className="demo-only-badge">DEMO ONLY</span>
          </div>
          <div className="demo-card-content">
            <div className="demo-invoice-heading">
              <span>
                EXAMPLE ORDER <b>#1042</b>
              </span>
              <span className="demo-status">
                <i />
                {status}
              </span>
            </div>
            <div className="demo-total">
              100 <span>{symbol}</span>
              <small>Example invoice amount</small>
            </div>
            <label className="demo-network">
              <span>
                <ChainLogo chain={network} size={28} />
                <span>
                  <small>PAYMENT NETWORK</small>
                  <b>{chain.name}</b>
                </span>
              </span>
              <select
                aria-label="Preview payment network"
                value={network}
                onChange={(event) => {
                  setNetwork(event.target.value);
                  if (event.target.value === "tempo") setNative(false);
                }}
              >
                {chainPages.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <div
              className="demo-assets"
              role="group"
              aria-label="Preview payment asset"
            >
              <button aria-pressed={!native} onClick={() => setNative(false)}>
                <span className="demo-coin">$</span>
                <span>
                  <b>sUSD</b>
                  <small>Test stablecoin</small>
                </span>
                {!native && <Check size={14} />}
              </button>
              <button
                disabled={network === "tempo"}
                aria-pressed={native}
                onClick={() => setNative(true)}
              >
                <ChainLogo chain={network} size={25} />
                <span>
                  <b>{nativeAsset[network] || "TIP-20 only"}</b>
                  <small>
                    {network === "tempo" ? "No native asset" : "Native asset"}
                  </small>
                </span>
                {native && <Check size={14} />}
              </button>
            </div>
            <div className="demo-deposit-control">
              <span>Example deposit</span>
              <div role="group" aria-label="Preview deposit amount">
                {[10, 100, 500].map((amount) => (
                  <button
                    key={amount}
                    aria-pressed={deposit === amount}
                    onClick={() => setDeposit(amount)}
                  >
                    {amount}
                  </button>
                ))}
              </div>
              <span>{symbol}</span>
            </div>
            <label className="demo-sponsor">
              <input
                type="checkbox"
                checked={sponsored}
                onChange={(event) => setSponsored(event.target.checked)}
              />
              <span>
                Merchant sponsors collection
                <small>
                  {sponsored
                    ? "Zero reward · One merchant payout"
                    : "Or offer an executor a 2-token reward"}
                </small>
              </span>
            </label>
            <div className="demo-live-ledger" aria-live="polite">
              <div>
                <span>Example received</span>
                <b>
                  {deposit} {symbol}
                </b>
              </div>
              <div>
                <span>
                  {deposit < 100
                    ? "Remaining to fund"
                    : deposit > 100
                      ? "Above invoice"
                      : "Invoice funding"}
                </span>
                <b>
                  {deposit < 100
                    ? `${100 - deposit} ${symbol}`
                    : deposit > 100
                      ? `${deposit - 100} ${symbol}`
                      : "Exact amount"}
                </b>
              </div>
              <div>
                <span>Executor reward</span>
                <b>
                  {reward} {symbol}
                </b>
              </div>
              <div className="demo-merchant-receipt">
                <span>Merchant would receive</span>
                <b key={`${deposit}-${reward}-${symbol}`}>
                  {deposit - reward} {symbol}
                </b>
              </div>
            </div>
            <p className="demo-caption">
              Illustration only. These controls never send a transaction.
              <br />
              Open Launch app to create, fund and settle a testnet order.
            </p>
          </div>
          <div className="demo-fixed-destination">
            <LockKeyhole size={12} /> Any executor. One signed merchant
            destination.
          </div>
        </div>
      </div>
    </section>
  );
}
