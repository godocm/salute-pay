"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Code2,
  FileSignature,
  Link2,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { PaymentHero } from "./payment-hero";
import { GatewayComparison } from "./gateway-comparison";
import { SiteHeader, SiteFooter } from "./site-shell";
import { ChainTicker } from "./chain-ticker";
import { InfrastructureFlow } from "./infrastructure-flow";

export function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add("revealed");
            observer.unobserve(el);
          }
        }),
      { threshold: 0.08 },
    );
    el.classList.add("reveal-ready");
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
export default function Homepage() {
  return (
    <div className="landing-theme">
      <SiteHeader />
      <main className="marketing-main">
        <PaymentHero />
        <ChainTicker />
        <section id="how-it-works" className="how-section section-width">
          <Reveal>
            <div className="section-heading">
              <span className="m-eyebrow">ONE SIMPLE FLOW</span>
              <h2>
                Anybody can create an order.
                <br />
                <em>Anybody can settle it.</em>
              </h2>
              <p>
                The merchant sets the terms. The customer sends funds.
                <br className="desktop-break" /> An executor delivers them to
                the signed destination.
              </p>
            </div>
          </Reveal>
          <div className="steps-grid">
            {[
              {
                num: "01",
                Icon: FileSignature,
                title: "Create & sign",
                desc: "Choose a network, asset and optional executor reward. Sign the order and share its payment link.",
                meta: "Merchant · Off-chain signature",
              },
              {
                num: "02",
                Icon: Wallet,
                title: "Send to one address",
                desc: "Pay from a wallet or an exchange withdrawal. Each order has a unique address to match incoming funds.",
                meta: "Customer · On-chain deposit",
              },
              {
                num: "03",
                Icon: Zap,
                title: "Settle to the merchant",
                desc: "Any executor can collect. The signed merchant receives the balance, minus the agreed reward.",
                meta: "Executor · On-chain collection",
              },
            ].map(({ num, Icon, title, desc, meta }) => (
              <Reveal key={num} className="flow-step">
                <div className="step-top">
                  <span>{num}</span>
                  <Icon size={27} />
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
                <small>{meta}</small>
              </Reveal>
            ))}
          </div>
          <p className="flow-footnote">
            SPL tokens need payment-address setup before funding. Network costs
            and account rent still apply.
          </p>
        </section>
        <section className="difference-section">
          <div className="section-width">
            <Reveal className="difference-heading">
              <span className="m-eyebrow">CONTROL BUILT INTO EVERY PAYMENT</span>
              <h2>
                Your funds. Your terms.
                <br />
                <em>Your power to settle.</em>
              </h2>
              <p>
                Your signature fixes where the money goes.
                <br />
                Collection stays open. The dashboard stays optional.
              </p>
            </Reveal>
            <div className="differences-grid">
              <Reveal className="difference-card">
                <InfrastructureFlow kind="orders" />
                <span className="feature-number">01 / PAYOUT CONTROL</span>
                <h3>
                  Your payout.
                  <br />Nobody can redirect it.
                </h3>
                <p>
                  Every order has its own payment address and a merchant
                  destination locked by your signature. Salute and executors
                  cannot change it. Partial, excess and late deposits remain
                  collectable to that same destination.
                </p>
              </Reveal>
              <Reveal className="difference-card">
                <InfrastructureFlow kind="deploy" />
                <span className="feature-number">02 / EVM EFFICIENCY</span>
                <h3>
                  No payment.
                  <br />
                  No EVM deployment.
                </h3>
                <p>
                  Sign and share EVM orders off-chain, without paying to deploy
                  an unused receiver. Once funded, its deployment and first
                  payout happen in one atomic transaction: both succeed or both
                  revert.
                </p>
              </Reveal>
              <Reveal className="difference-card">
                <InfrastructureFlow kind="collect" />
                <span className="feature-number">03 / INDEPENDENT SETTLEMENT</span>
                <h3>
                  Settle on your terms.
                  <br />
                  Even without Salute.
                </h3>
                <p>
                  Run your own collector or authorize a capped executor reward.
                  With exported signed orders and access to the network, you
                  can collect through public contracts even if the dashboard
                  disappears. Your subscription does not control settlement.
                </p>
              </Reveal>
            </div>
            <div className="difference-bottom">
              <ShieldCheck size={19} />
              <span>
                No EVM/TRON payout admin. Solana’s deployed program is
                immutable.
              </span>
              <Link href="/docs#security">
                Explore the trust model <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
        </section>
        <GatewayComparison />
        <section className="audience-section section-width">
          <Reveal className="section-heading">
            <span className="m-eyebrow">BUILT FOR PEOPLE WHO BUILD</span>
            <h2>
              Your checkout. Your integration.
              <br />
              <em>Your way to collect.</em>
            </h2>
          </Reveal>
          <div className="audience-layout">
            <div className="audience-items">
              {[
                {
                  Icon: Link2,
                  title: "Merchants & online businesses",
                  desc: "Share a payment link. Accept wallet transfers and exchange withdrawals without opening a custodial balance.",
                },
                {
                  Icon: Code2,
                  title: "Platforms & developers",
                  desc: "Build your own checkout around signed intents, verified receipts and optional webhook infrastructure.",
                },
                {
                  Icon: Zap,
                  title: "Independent executors",
                  desc: "Review funded orders, pay the network cost and earn the merchant-authorized reward when you settle.",
                },
              ].map(({ Icon, title, desc }) => (
                <Reveal key={title}>
                  <Icon size={22} />
                  <div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal className="builder-panel">
              <div className="builder-panel-top">
                <span />
                <span />
                <span />
                <small>THE ORDER IS PORTABLE</small>
              </div>
              <pre>
                <code>
                  <span className="code-comment">
                    // Your signature fixes the payout.
                  </span>
                  {"\n"}
                  <span className="code-key">merchant</span>
                  {":  yourWallet\n"}
                  <span className="code-key">invoice</span>
                  {":   100 sUSD\n"}
                  <span className="code-key">reward</span>
                  {":    2 sUSD\n"}
                  <span className="code-key">executor</span>
                  {":  anyone"}
                </code>
              </pre>
              <div className="builder-panel-foot">
                <span>Illustrative order terms</span>
                <Link href="/docs">
                  Start integrating <ArrowRight size={15} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
        <section className="pricing-teaser section-width">
          <Reveal>
            <span className="m-eyebrow">PAY FOR THE TOOLS, NOT THE VOLUME</span>
            <h2>
              Fixed dashboard pricing.
              <br />
              Open protocol access.
            </h2>
            <p>
              Infrastructure starts at $0. All EVM rails from $49/month.
              <br />
              Network costs and executor rewards are separate.
            </p>
            <a href="/pricing.html" className="m-button m-secondary">
              Explore plans <ArrowUpRight size={17} />
            </a>
          </Reveal>
          <div className="pricing-teaser-right">
            <span>0%</span>
            <p>
              Salute platform fee
              <br />
              on contract collections
            </p>
            <small>Optional dashboard subscription</small>
          </div>
        </section>
        <section className="faq-section section-width">
          <Reveal className="section-heading">
            <span className="m-eyebrow">A FEW THINGS TO KNOW</span>
            <h2>Clear terms. No surprises.</h2>
          </Reveal>
          <div className="faq-list">
            {[
              {
                q: "Does Salute ever hold the payment?",
                a: "The protocol collects from an order-specific address to the merchant fixed by the signed order. Salute has no gateway custody key or payout setter. The dashboard is optional infrastructure.",
              },
              {
                q: "If Salute goes offline, can I still collect my crypto?",
                a: "Yes. As the merchant, you can use an exported signed order and an independent executor to collect supported funds to your fixed wallet destination, without Salute’s website or API. The executor needs access to the chain and its transaction fees. Funds already collected remain in your wallet. Keep your signed-order backups: custody control alone does not replace the order data. A platform outage does not give customers a refund or anyone permission to redirect the payout.",
              },
              {
                q: "Can a customer pay from an exchange?",
                a: "Customers can fund the unique address with an ordinary on-chain transfer; they do not sign the merchant’s order. Select the exact network and token. SPL token accounts must be prepared first, and the withdrawal provider must accept the destination.",
              },
              {
                q: "What happens with an underpayment or a second deposit?",
                a: "The supported balance can be collected regardless of the invoice amount. Each rewarded sweep uses the signed fixed reward. If a deposit cannot cover that reward, an executor or the merchant can sponsor a sweep with the reward waived. Invoice accounting is separate from collection.",
              },
              {
                q: "Does recovery move funds between chains?",
                a: "No. Compatible EVM deployments can recover to the merchant on the chain where funds arrived, using unchanged signed order terms and matching canonical factories. It does not bridge or convert assets. Solana and TRON are separate payment rails.",
              },
              {
                q: "Is this available on mainnet?",
                a: "This release is a public testnet preview across eight networks. Use test assets only. See developer docs for activated deployments, supported assets and the current trust model.",
              },
            ].map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <span>+</span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing-cta">
          <div className="section-width">
            <span className="m-eyebrow">THE NEXT PAYMENT IS YOURS</span>
            <h2>Make it a direct one.</h2>
            <div>
              <Link className="m-button m-lime" href="/app">
                Launch the testnet app <ArrowUpRight size={18} />
              </Link>
              <Link className="closing-docs" href="/docs">
                Read the protocol docs <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
