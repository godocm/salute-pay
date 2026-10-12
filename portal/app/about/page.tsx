import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Code2, Wallet, Mail } from "lucide-react";
import { SiteHeader, SiteFooter } from "../../components/site-shell";
export const metadata: Metadata = {
  title: "About · Salute Pay",
  description:
    "Salute Pay is non-custodial payment infrastructure from Salute Bank. Meet the protocol and connect with the team.",
};
export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="about-main section-width">
        <section className="about-hero">
          <span className="m-eyebrow">FROM SALUTE BANK</span>
          <h1>
            A better way to collect.
            <br />
            <span>A simpler way to build.</span>
          </h1>
          <p>
            Salute Pay is the non-custodial payment protocol we’re building
            alongside Salute Bank. It gives merchants signed payment orders,
            unique deposit addresses and permissionless collection across
            distinct on-chain payment rails.
          </p>
          <div className="about-badges">
            <span>
              <ShieldCheck size={14} /> Merchant-owned destination
            </span>
            <span>
              <Code2 size={14} /> Open-source contracts
            </span>
          </div>
        </section>
        <section className="about-split">
          <div>
            <span className="m-eyebrow">THE PRINCIPLE</span>
            <h2>
              Payment infrastructure should
              <br />
              serve the merchant.
            </h2>
            <p>
              Anybody can create an order. Anybody can settle it. The merchant
              signs the payout terms, and the protocol enforces the destination.
            </p>
            <p>
              An executor supplies the transaction. Salute supplies an optional
              dashboard, publisher and webhook service. These tools help you
              operate; they do not own the funds.
            </p>
            <Link href="/docs#security" className="m-button m-text">
              Understand the trust model <ArrowRightIcon />
            </Link>
          </div>
          <div className="about-protocol">
            <div>
              <Wallet size={22} />
              <h3>The protocol</h3>
              <p>
                Permissionless collection to a fixed merchant. EVM/TRON
                contracts have no payout admin; the deployed Solana program has
                no upgrade authority.
              </p>
            </div>
            <div>
              <Code2 size={22} />
              <h3>The dashboard</h3>
              <p>
                Payment links, order history, verified receipts and webhook
                delivery. An optional service with fixed subscription plans and
                its own operational infrastructure.
              </p>
            </div>
          </div>
        </section>
        <section className="about-contact" id="contact">
          <div>
            <span className="m-eyebrow">LET’S CONNECT</span>
            <h2>
              Build with us.
              <br />
              Talk to the team.
            </h2>
            <p>Follow the project, explore the code or contact us by email.</p>
          </div>
          <div className="contact-links">
            <a href="mailto:support@salutebank.com">
              <Mail size={23} aria-hidden="true" />
              <span>Email<small>support@salutebank.com</small></span>
              <ArrowUpRight size={18} />
            </a>
            <a
              href="https://www.linkedin.com/company/salute-bank"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="/brand/linkedin.svg"
                width="23"
                height="23"
                alt=""
                aria-hidden="true"
              />
              <span>
                LinkedIn<small>Salute Bank</small>
              </span>
              <ArrowUpRight size={18} />
            </a>
            <a href="https://x.com/salutebank" target="_blank" rel="noreferrer">
              <svg
                viewBox="0 0 24 24"
                width="23"
                height="23"
                aria-hidden="true"
              >
                <path
                  d="M18.9 2H22l-6.8 7.8L23 22h-6.1l-4.8-6.7L6.2 22H3l7.6-8.7L1 2h6.3l4.4 6.1L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z"
                  fill="currentColor"
                />
              </svg>
              <span>
                Twitter / X<small>@salutebank</small>
              </span>
              <ArrowUpRight size={18} />
            </a>
            <a
              href="https://github.com/godocm/salute-pay"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="/brand/github.svg"
                width="23"
                height="23"
                alt=""
                aria-hidden="true"
              />
              <span>
                GitHub<small>godocm / salute-pay</small>
              </span>
              <ArrowUpRight size={18} />
            </a>
          </div>
        </section>
        <div className="about-status">
          <span className="status-dot" />
          <p>
            Public testnet preview. Eight networks are activated. This release
            does not accept mainnet payments.
          </p>
          <Link href="/docs#deployments">
            View deployments <ArrowUpRight size={14} />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={16} />;
}
