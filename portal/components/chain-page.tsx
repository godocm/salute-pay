import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  FileSignature,
  Wallet,
  Zap,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import { ChainLogo } from "./brand";
import { SiteHeader, SiteFooter } from "./site-shell";
import { chainPages, type ChainPage as ChainContent } from "../lib/chain-pages";

export function ChainPage({ chain: c }: { chain: ChainContent }) {
  return (
    <>
      <SiteHeader />
      <main className={`chain-main theme-${c.theme}`}>
        <section className="chain-hero">
          <div className="section-width chain-hero-grid">
            <div>
              <Link href="/chains" className="chain-back">
                <ChevronLeft size={14} /> All chains
              </Link>
              <div className="chain-name">
                <ChainLogo chain={c.id} size={26} />
                <span>{c.name}</span>
                <small>{c.category}</small>
              </div>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
              <div className="chain-actions">
                <Link
                  href={`/app?chain=${c.id}`}
                  className="m-button chain-button"
                >
                  Launch testnet app <ArrowUpRight size={17} />
                </Link>
                <a href="#payment-flow" className="chain-flow-link">
                  Explore the flow <ArrowRight size={16} />
                </a>
              </div>
              <span className="chain-environment">
                <i /> Salute deployment: {c.testnet} · Test assets only
              </span>
            </div>
            <div className="chain-art" aria-hidden="true">
              <div className="chain-art-orbit orbit-a" />
              <div className="chain-art-orbit orbit-b" />
              <div className="chain-art-logo">
                <ChainLogo chain={c.id} size={114} />
              </div>
              <div className="chain-art-note art-sign">
                <FileSignature size={16} />
                <span>
                  Signed order<small>{c.authorization}</small>
                </span>
              </div>
              <div className="chain-art-note art-wallet">
                <Wallet size={16} />
                <span>
                  Merchant wallet<small>Fixed destination</small>
                </span>
              </div>
              <span className="chain-art-caption">
                NETWORK-NATIVE SETTLEMENT
              </span>
            </div>
          </div>
        </section>
        <div className="chain-facts section-width">
          <div>
            <span>AUTHORIZATION</span>
            <b>{c.authorization}</b>
          </div>
          <div>
            <span>ORDER ADDRESS</span>
            <b>{c.address}</b>
          </div>
          <div>
            <span>NETWORK COST</span>
            <b>{c.gas}</b>
          </div>
        </div>
        <section className="chain-why section-width">
          <div>
            <span className="m-eyebrow">WHY {c.name.toUpperCase()}</span>
            <h2>{c.highlight}</h2>
            <p>{c.highlightDetail}</p>
          </div>
          <div className="chain-usecase">
            <span className="m-eyebrow">EXAMPLE MERCHANT USE CASE</span>
            <h3>{c.useCase}</h3>
            <p>{c.useCaseDetail}</p>
          </div>
        </section>
        <section id="payment-flow" className="chain-flow-section section-width">
          <div className="chain-section-heading">
            <span className="m-eyebrow">THE SALUTE FLOW</span>
            <h2>
              From order to settlement.
              <br />
              <em>On {c.name}.</em>
            </h2>
            <p>
              The network changes. The merchant’s control of the payout stays
              the same.
            </p>
          </div>
          <ol className="chain-flow-list">
            {c.steps.map((s, i) => (
              <li key={s.title}>
                <div className="chain-step-number">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div>
                  <span>{s.actor}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
                <ArrowRight size={21} />
              </li>
            ))}
          </ol>
          {c.id === "solana" && (
            <div className="sol-paths">
              <div>
                <b>Native SOL</b>
                <p>Sign → prefund vault → atomic registration + collection</p>
              </div>
              <div>
                <b>SPL tokens</b>
                <p>
                  Sign → merchant sets up token account → customer funds →
                  collection
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="chain-notes section-width">
          <div>
            <ShieldCheck size={24} />
            <h2>Before you integrate.</h2>
            <p>
              Network features and Salute’s implemented capabilities are
              distinct.
            </p>
          </div>
          <ul>
            {c.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
        <section className="chain-resources section-width">
          <div>
            <span className="m-eyebrow">BUILD WITH THE DETAILS</span>
            <h2>
              Contract addresses.
              <br />
              Integration docs. Source.
            </h2>
            <Link
              className="m-button m-primary"
              href={`/docs#deployment-${c.id}`}
            >
              Deployed contract in docs <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="chain-source-links">
            <span>PRIMARY NETWORK SOURCES · CHECKED 12 OCT 2026</span>
            {c.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                {s.title}
                <ArrowUpRight size={15} />
              </a>
            ))}
            <p>
              Use cases on this page are examples. Network marks identify
              integrations and do not imply endorsements.
            </p>
          </div>
        </section>
        <nav className="chain-other section-width" aria-label="Other chains">
          <span>Explore another rail</span>
          {chainPages
            .filter((n) => n.id !== c.id)
            .map((n) => (
              <Link href={`/chains/${n.id}`} key={n.id}>
                <ChainLogo chain={n.id} size={20} />
                {n.name}
              </Link>
            ))}
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
