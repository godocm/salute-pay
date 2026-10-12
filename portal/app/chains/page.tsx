import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { chainPages } from "../../lib/chain-pages";
import { ChainLogo } from "../../components/brand";
import { SiteHeader, SiteFooter } from "../../components/site-shell";
export const metadata = {
  title: "Eight chains · Salute Pay",
  description:
    "Explore network-native payment flows across Salute Pay’s eight testnet integrations.",
};
export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="chains-index section-width">
        <span className="m-eyebrow">
          ONE INTEGRATION. NETWORK-NATIVE SETTLEMENT.
        </span>
        <h1>
          Eight chains.
          <br />
          <em>One payment infrastructure.</em>
        </h1>
        <p>
          A shared order experience, with a native execution adapter for each
          network. Choose a chain to explore its use case, costs and settlement
          flow.
        </p>
        <div className="chain-index-grid">
          {chainPages.map((c) => (
            <Link
              href={`/chains/${c.id}`}
              className={`chain-index-card theme-${c.theme}`}
              key={c.id}
            >
              <div>
                <ChainLogo chain={c.id} size={42} />
                <ArrowUpRight size={21} />
              </div>
              <span>{c.category}</span>
              <h2>{c.name}</h2>
              <p>{c.highlight}</p>
              <b>
                Explore payment flow <ArrowUpRight size={14} />
              </b>
            </Link>
          ))}
        </div>
        <p className="chains-index-note">
          Eight Salute deployments are activated on public testnets. Funds
          settle on the network where they arrive; this is not bridging or
          exchange.{" "}
          <Link href="/docs#deployments">
            View verified contract addresses.
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
