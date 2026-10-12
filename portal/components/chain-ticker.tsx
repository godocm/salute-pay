"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ChainLogo } from "./brand";
import { chainPages } from "../lib/chain-pages";

export function ChainTicker() {
  return (
    <section className="chain-ticker" aria-label="Explore eight supported chains">
      <div className="ticker-heading section-width"><span>8 CHAINS. ONE PAYMENT INFRASTRUCTURE.</span></div>
      <div className="ticker-window"><div className="ticker-track">
        {[false, true].map((duplicate) => <div className={`ticker-group${duplicate ? " ticker-duplicate" : ""}`} aria-hidden={duplicate} key={duplicate ? "duplicate" : "primary"}>
          {chainPages.map((c) => <Link href={`/chains/${c.id}`} tabIndex={duplicate ? -1 : undefined} key={c.id}><ChainLogo chain={c.id} size={32} /><b>{c.name}</b><ArrowUpRight size={15} /></Link>)}
        </div>)}
      </div></div>
      <p className="ticker-hint">Select a chain to explore its payment flow.</p>
    </section>
  );
}
