"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  FileSignature,
  Layers3,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import registry from "../public/deployments/main.json";
import evmNetworks from "../lib/evm-networks.json";
import { SiteHeader, SiteFooter } from "./site-shell";
import { ChainLogo } from "./brand";
type Rail = "tempo" | "solana" | "tron" | "evm";
const names: Record<string, string> = {
  tempo: "Tempo Moderato",
  solana: "Solana Devnet",
  tron: "TRON Nile",
  ethereum: "Ethereum Sepolia",
  base: "Base Sepolia",
  arbitrum: "Arbitrum Sepolia",
  bnb: "BNB Testnet",
  robinhood: "Robinhood Testnet",
};
const rails: { id: Rail; name: string; logo: string }[] = [
  { id: "tempo", name: "Tempo", logo: "tempo" },
  { id: "solana", name: "Solana", logo: "solana" },
  { id: "tron", name: "TRON", logo: "tron" },
  { id: "evm", name: "Ethereum & EVM", logo: "ethereum" },
];
const railDetails = {
  tempo: {
    label: "EIP-712 · TIP-20",
    title: "Stablecoin collection, with a funded fee token.",
    desc: "Tempo uses the EVM factory and deterministic receiver model. Payments use transferable TIP-20 tokens; the executor configures and funds an accepted transaction-fee token.",
    steps: [
      "Sign fixed order terms",
      "Fund predicted receiver",
      "Deploy + collect",
      "Pay merchant + reward",
    ],
    items: [
      "The signature binds the origin chain, canonical factory and original order terms. Invoice amount is an accounting expectation, not a minimum deposit.",
      "The factory verifies authorization, creates the immutable receiver after funding and performs the initial payout atomically.",
      "Exact recipient balance checks reject policy redirection. Restricted or frozen tokens can revert; Salute does not bypass issuer rules.",
    ],
    cost: "TIP-20 fee token must be funded. No native-currency payment path.",
    code: "factory.collect(order, signature, asset, waiveReward)",
    source: "contracts/PaymentCollection.sol",
  },
  solana: {
    label: "ED25519 · SOL / CLASSIC SPL",
    title: "One immutable program. Merchant-bound accounts.",
    desc: "An Ed25519 message binds the program, network domain and order terms. The program derives an order PDA and a vault; there is no separate program deployment for each payment.",
    steps: [
      "Sign the order message",
      "Fund vault / prepared ATA",
      "Register + collect",
      "Pay merchant + reward",
    ],
    items: [
      "Native SOL can prefund the vault before atomic registration and collection when rent-exemption requirements are met. The merchant can prepare it for smaller deposits.",
      "SPL tokens require an initialized vault token account before funding. The app asks the merchant to sponsor setup and rent before sharing the payment address. Wallet checkout can create a missing token account in the same transaction as payment, with the payer covering its rent in SOL.",
      "The program retains the vault reserve for late deposits. Wrong-mint collection pays the same merchant without the intended-token reward. Public upgrade authority is revoked.",
    ],
    cost: "SOL transaction fees plus account setup/rent. SPL setup is an additional step.",
    code: "register_sol / register_token → collect_sol / collect_token",
    source: "solana/programs/salute_pay/src/lib.rs",
  },
  tron: {
    label: "TIP-712 · TRX / TRC-20",
    title: "A native TVM payment rail.",
    desc: "TRON uses its own TIP-712 authorization and TVM deterministic address derivation. A dedicated factory collects TRX and standard transferable TRC-20 balances to the signed merchant.",
    steps: [
      "Sign TIP-712 terms",
      "Fund TVM receiver",
      "Deploy + collect",
      "Pay merchant + reward",
    ],
    items: [
      "The factory verifies the signed merchant terms before deployment and collection. Underpayments, overpayments and later deposits remain collectable.",
      "The destination is fixed. A zero reward, explicit waiver or merchant self-collection produces only the merchant payout.",
      "TRON addresses and TVM CREATE2 derivation differ from EVM. A matching Ethereum factory does not make an EVM address recoverable on TRON.",
    ],
    cost: "Bandwidth and Energy; TRX can be burned when resources are insufficient.",
    code: "factory.collect(order, signature, asset, waiveReward)",
    source: "tron/contracts/SaluteTron.sol",
  },
  evm: {
    label: "EIP-712 · NATIVE / ERC-20",
    title: "Create orders off-chain. Deploy only when funded.",
    desc: "Ethereum, Base, Arbitrum, BNB and Robinhood use the same main EVM implementation. CREATE2 and immutable arguments derive a receiver from the original order terms and canonical factory.",
    steps: [
      "Sign EIP-712 order",
      "Fund CREATE2 address",
      "Deploy + collect",
      "Pay merchant + reward",
    ],
    items: [
      "Original terms fix the merchant, intended asset, invoice amount, reward, order ID and origin chain. The executing chain never replaces the origin chain in receiver derivation.",
      "Any executor can call the factory. First deployment and payout succeed together or revert together. Repeated sweeps reuse the receiver.",
      "Portable EOA authorization permits compatible wrong-chain recovery only when factory, deployment root, bytecode, implementation and terms match. Foreign ERC-1271 authorization is unsupported.",
    ],
    cost: "Payer deposit and executor collection incur chain fees; L2 costs differ from L1.",
    code: "factory.collect(order, signature, asset, waiveReward)",
    source: "contracts/PaymentCollection.sol",
  },
};
const sessionCode = `const { id, message } = await post("/api/auth/challenge", {
  chain: "ethereum", address: merchantAddress
});
await post("/api/auth/verify", {
  id, signature: await signer.signMessage(message)
});
// signedOrder is exported from the merchant app.
const payment = await post("/api/payments", signedOrder);
const checkout = location.origin + "/pay/" + payment.slug;`;
const webhookCode = `import { createHmac, timingSafeEqual } from "node:crypto";
const timestamp = req.headers["salute-timestamp"];
const received = req.headers["salute-signature"] || "";
if (!/^\\d+$/.test(timestamp || "") ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
  throw new Error("Expired webhook");
const expected = "v1=" + createHmac("sha256", secret)
  .update(timestamp + "." + rawBody).digest("hex");
const a = Buffer.from(received), b = Buffer.from(expected);
if (a.length !== b.length || !timingSafeEqual(a, b))
  throw new Error("Invalid signature");
// Deduplicate salute-event-id before processing.`;
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <button
      className="copy-control"
      aria-label={`${label}${copied ? " — copied" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setFailed(false);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span aria-live="polite">
        {failed ? "Select to copy" : copied ? "Copied" : label}
      </span>
    </button>
  );
}
export default function DeveloperDocs() {
  const [rail, setRail] = useState<Rail>("tempo");
  const [solAsset, setSolAsset] = useState<"sol" | "spl">("sol");
  useEffect(() => {
    const update = () => {
      const h = location.hash.slice(1);
      if (rails.some((r) => r.id === h)) {
        setRail(h as Rail);
        requestAnimationFrame(() =>
          document.getElementById("networks")?.scrollIntoView(),
        );
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const d = railDetails[rail];
  const flowSteps =
    rail === "solana"
      ? solAsset === "spl"
        ? [
            "Sign Ed25519 order",
            "Register + create ATA",
            "Customer funds ATA",
            "Collect + pay merchant",
          ]
        : [
            "Sign Ed25519 order",
            "Customer prefunds SOL",
            "Register + collect",
            "Pay merchant + reward",
          ]
      : d.steps;
  return (
    <>
      <SiteHeader />
      <main className="docs-layout section-width">
        <aside className="docs-sidebar">
          <span>DEVELOPER DOCS</span>
          <nav aria-label="Documentation sections">
            {[
              { id: "overview", label: "Overview" },
              { id: "flow", label: "Payment lifecycle" },
              { id: "networks", label: "Contract flows" },
              { id: "deployments", label: "Deployed addresses" },
              { id: "api", label: "Publisher API" },
              { id: "webhooks", label: "Webhooks" },
              { id: "recovery", label: "Balances & recovery" },
              { id: "security", label: "Trust model" },
            ].map((n) => (
              <a key={n.id} href={`#${n.id}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <a
            className="docs-github"
            href="https://github.com/godocm/salute-pay"
            target="_blank"
            rel="noreferrer"
          >
            View source <ArrowUpRight size={14} />
          </a>
          <Link className="docs-settings" href="/developer">
            Webhook settings <ArrowRight size={14} />
          </Link>
          <span className="docs-status">
            <i /> Testnet release
          </span>
        </aside>
        <div className="docs-content">
          <section id="overview" className="docs-intro">
            <span className="m-eyebrow">INTEGRATE SALUTE PAY</span>
            <h1>
              Build on
              <br />
              <span>open settlement.</span>
            </h1>
            <p>
              Signed orders. Unique addresses. Verified receipts.
              <br />
              Use the optional dashboard API or build directly on the protocol.
            </p>
            <div className="docs-quicklinks">
              <Link href="/app">
                <FileSignature size={16} /> Create a test order{" "}
                <ArrowUpRight size={15} />
              </Link>
              <a href="#deployments">
                <Layers3 size={16} /> Contract addresses{" "}
                <ArrowRight size={15} />
              </a>
            </div>
            <div className="docs-callout">
              <ShieldCheck size={20} />
              <p>
                Eight public testnet deployments are activated. Use test assets
                only. Dashboard sessions authorize publication and settings;
                they never authorize changes to a merchant payout.
              </p>
            </div>
          </section>
          <section id="flow" className="doc-section">
            <span className="doc-section-number">01 / LIFECYCLE</span>
            <h2>From signature to merchant receipt.</h2>
            <div className="doc-lifecycle">
              {[
                {
                  Icon: FileSignature,
                  title: "Create & sign",
                  desc: "Merchant chooses terms and signs off-chain.",
                },
                {
                  Icon: Wallet,
                  title: "Fund",
                  desc: "Customer sends to the derived address.",
                },
                {
                  Icon: Zap,
                  title: "Collect",
                  desc: "Any executor submits the authorized collection.",
                },
              ].map(({ Icon, title, desc }) => (
                <div key={title}>
                  <Icon size={23} />
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
            <p>
              Export the signed order before sharing it. It contains the
              authorization an independent executor needs. The published
              checkout exposes the network, asset, expected amount, QR code and
              address; exchange payers do not need to sign the order.
            </p>
          </section>
          <section id="networks" className="doc-section">
            <span className="doc-section-number">02 / CONTRACT FLOWS</span>
            <h2>One experience. Distinct execution environments.</h2>
            <div
              className="rail-tabs"
              role="tablist"
              aria-label="Contract execution environment"
            >
              {rails.map((r) => (
                <button
                  key={r.id}
                  id={`tab-${r.id}`}
                  role="tab"
                  aria-selected={rail === r.id}
                  aria-controls={`panel-${r.id}`}
                  tabIndex={rail === r.id ? 0 : -1}
                  onClick={() => setRail(r.id)}
                  onKeyDown={(event) => {
                    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
                    if (!keys.includes(event.key)) return;
                    event.preventDefault();
                    const current = rails.findIndex((item) => item.id === rail);
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? rails.length - 1
                          : (current +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              rails.length) %
                            rails.length;
                    setRail(rails[next].id);
                    document.getElementById(`tab-${rails[next].id}`)?.focus();
                  }}
                >
                  <ChainLogo chain={r.logo} size={20} />
                  {r.name}
                </button>
              ))}
            </div>
            <div
              key={rail}
              role="tabpanel"
              id={`panel-${rail}`}
              aria-labelledby={`tab-${rail}`}
              className="rail-panel"
            >
              <span className="rail-label">{d.label}</span>
              <h3>{d.title}</h3>
              <p>{d.desc}</p>
              {rail === "solana" && (
                <div
                  className="sol-asset-options"
                  role="group"
                  aria-label="Solana payment asset"
                >
                  <button
                    aria-pressed={solAsset === "sol"}
                    onClick={() => setSolAsset("sol")}
                  >
                    Native SOL
                  </button>
                  <button
                    aria-pressed={solAsset === "spl"}
                    onClick={() => setSolAsset("spl")}
                  >
                    SPL tokens
                  </button>
                </div>
              )}
              <div
                className="contract-flow"
                aria-label={`${rail} contract flow`}
              >
                {flowSteps.map((s, i) => (
                  <div key={s}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <b>{s}</b>
                    {i < 3 && <ArrowRight size={15} />}
                  </div>
                ))}
              </div>
              <ul>
                {d.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <div className="rail-cost">
                <Zap size={15} />
                <p>{d.cost}</p>
              </div>
              <div className="method-signature">
                <code>{d.code}</code>
                <a
                  href="https://github.com/godocm/salute-pay"
                  target="_blank"
                  rel="noreferrer"
                >
                  View repository <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
          </section>
          <section id="deployments" className="doc-section">
            <span className="doc-section-number">03 / DEPLOYED ADDRESSES</span>
            <h2>Activated testnet contracts.</h2>
            <p>
              These addresses come directly from the app’s deployment registry.
              EVM networks share the canonical factory address. Solana uses one
              immutable program; TRON uses a separate TVM factory.
            </p>
            <div className="deployment-list">
              {Object.entries(registry.networks)
                .sort(
                  ([a], [b]) =>
                    [
                      "tempo",
                      "solana",
                      "tron",
                      "ethereum",
                      "base",
                      "arbitrum",
                      "bnb",
                      "robinhood",
                    ].indexOf(a) -
                    [
                      "tempo",
                      "solana",
                      "tron",
                      "ethereum",
                      "base",
                      "arbitrum",
                      "bnb",
                      "robinhood",
                    ].indexOf(b),
                )
                .map(([key, n]) => {
                  const explorer =
                    key === "solana"
                      ? `https://explorer.solana.com/address/${n.deployment}?cluster=devnet`
                      : key === "tron"
                        ? `https://nile.tronscan.org/#/contract/${n.deployment}`
                        : `${evmNetworks[key as keyof typeof evmNetworks].explorer}/address/${n.deployment}`;
                  return (
                    <div
                      className="deployment-row"
                      id={`deployment-${key}`}
                      key={key}
                    >
                      <div className="deployment-name">
                        <ChainLogo chain={key} size={25} />
                        <div>
                          <b>{names[key]}</b>
                          <small>
                            {key === "solana" ? "Program" : "Factory"} ·{" "}
                            {n.chainId}
                          </small>
                        </div>
                        <span>Testnet</span>
                      </div>
                      <div className="deployment-address">
                        <code>{n.deployment}</code>
                        <CopyButton text={n.deployment} label="Copy address" />
                        <a
                          href={explorer}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${names[key]} contract explorer`}
                        >
                          <ArrowUpRight size={15} />
                        </a>
                      </div>
                      <details className="token-detail">
                        <summary>Test token address</summary>
                        <code>{n.token}</code>
                        <CopyButton text={n.token} label="Copy token" />
                      </details>
                    </div>
                  );
                })}
            </div>
            <a
              className="doc-text-link"
              href="/deployments/main.json"
              target="_blank"
              rel="noreferrer"
            >
              Download deployment JSON <ArrowUpRight size={14} />
            </a>
          </section>
          <section id="api" className="doc-section">
            <span className="doc-section-number">04 / PUBLISHER API</span>
            <h2>Your app, connected.</h2>
            <p>
              The same-origin API uses a wallet-authenticated session. Get a
              one-use challenge, sign its exact message, and verify it.
              Challenges expire after five minutes; the HttpOnly session expires
              after twelve hours.
            </p>
            <div className="api-endpoints">
              {[
                {
                  method: "GET",
                  path: "/api/networks",
                  desc: "Public activated deployments and dashboard availability.",
                },
                {
                  method: "POST",
                  path: "/api/auth/challenge",
                  desc: "Send { chain, address }; receive { id, message }.",
                },
                {
                  method: "POST",
                  path: "/api/auth/verify",
                  desc: "Send { id, signature }; receive a session cookie.",
                },
                {
                  method: "GET",
                  path: "/api/me",
                  desc: "Your plan, usage and webhook configuration. Authentication required.",
                },
                {
                  method: "PUT",
                  path: "/api/settings",
                  desc: "Set { webhookUrl } to a public HTTPS URL, or an empty string to disable.",
                },
                {
                  method: "POST",
                  path: "/api/payments",
                  desc: "Publish exported signed order JSON; merchant authorization is checked. Testnet beta has no plan or monthly link limits.",
                },
                {
                  method: "GET",
                  path: "/api/payments",
                  desc: "Authenticated merchant list; append /{slug} for public payment data.",
                },
                {
                  method: "GET",
                  path: "/api/public-orders",
                  desc: "Orders merchants explicitly chose to expose to executors.",
                },
                {
                  method: "POST",
                  path: "/api/payments/{slug}/transactions",
                  desc: "Send { chain, hash } to queue receipt verification. It does not mark the invoice paid.",
                },
                {
                  method: "POST",
                  path: "/api/auth/logout",
                  desc: "Revoke the active session.",
                },
              ].map((e) => (
                <div key={`${e.method}:${e.path}`}>
                  <span className={`http-method ${e.method.toLowerCase()}`}>
                    {e.method}
                  </span>
                  <code>{e.path}</code>
                  <p>{e.desc}</p>
                </div>
              ))}
            </div>
            <div className="docs-code">
              <div>
                <span>Session → published checkout</span>
                <CopyButton text={sessionCode} />
              </div>
              <pre>
                <code>{sessionCode}</code>
              </pre>
            </div>
            <p className="doc-note">
              <code>post</code> is your JSON fetch helper with same-origin
              credentials, content-type and error handling. Order
              amounts/rewards are base-unit strings. The dashboard API requires
              a configured database; exported signed links and direct contract
              execution remain available independently.
            </p>
            <h3>Hosted or offline links</h3>
            <p>
              The testnet beta supports all eight activated networks without
              dashboard plan or monthly payment-link limits. Pricing applies to
              the production app. In Create payments, disable
              “Publish a hosted payment link” to use a signed offline link on
              any activated rail without a hosted plan. Export the order as a
              backup. Offline checkout verifies its signature and current chain
              balance; it cannot provide trusted cumulative accounting or
              webhooks.
            </p>
            <h3>Customer wallet connection is optional</h3>
            <p>
              The customer can copy or scan the payment address and transfer the
              specified asset on the specified network. Merchant authorization
              and executor signing still require wallets. This demo uses
              valueless test assets; commercial exchanges generally do not
              support their withdrawals.
            </p>
            <h3>Executor workflow</h3>
            <p>
              Select the payment network, open an order or import a hosted link,
              offline link or exported JSON, then connect your executor wallet.
              Opening an order verifies its signature, deployment and chain
              balance. Review the merchant destination, gross reward and
              estimated receipt. If the balance changes before signing, review
              it again. Network costs and account setup are paid by the
              executor; a reward does not guarantee profit.
            </p>
            <p>
              Keep your transaction receipt. A pending collection blocks
              duplicate execution in this browser until refreshed. Confirmation
              and indexing are separate: an unavailable status service cannot
              undo a mined collection. Another executor can win a race, so a
              failed or timed-out request must be checked on-chain before
              retrying. The public queue is an indexed snapshot and refreshes
              every 20 seconds while visible.
            </p>
            <Link className="doc-text-link" href="/developer">
              Configure developer settings <ArrowRight size={14} />
            </Link>
          </section>
          <section id="webhooks" className="doc-section">
            <span className="doc-section-number">05 / WEBHOOKS</span>
            <h2>Act on verified chain events.</h2>
            <p>
              Save your HTTPS endpoint in Developer settings. New payments
              send events only when you choose “Send webhook events” at creation. The server verifies
              chain receipts and writes events to a transactional outbox; a
              browser-supplied hash is only a verification candidate.
            </p>
            <div className="webhook-events">
              {[
                { name: "payment.created", desc: "Verified order published." },
                {
                  name: "payment.partially_paid",
                  desc: "Confirmed invoice-asset funding remains below expectation.",
                },
                {
                  name: "payment.paid",
                  desc: "Confirmed cumulative funding meets or exceeds the invoice.",
                },
                {
                  name: "payment.overpaid",
                  desc: "Confirmed cumulative invoice-asset funding exceeds the invoice. Also emits payment.paid for compatibility.",
                },
                {
                  name: "payment.collected",
                  desc: "Verified collection reports actual chain, asset, receipt and reward.",
                },
              ].map((e) => (
                <div key={e.name}>
                  <span className="event-dot" />
                  <code>{e.name}</code>
                  <p>{e.desc}</p>
                </div>
              ))}
            </div>
            <p>
              Delivery is at least once. Deduplicate{" "}
              <code>salute-event-id</code> and verify the exact raw body with
              HMAC-SHA256. Enforce timestamp freshness. Only a 2xx response
              acknowledges delivery; failures retry with backoff up to eight
              attempts. Redirects are not followed.
            </p>
            <div className="docs-code">
              <div>
                <span>Verify before processing · Node.js</span>
                <CopyButton text={webhookCode} />
              </div>
              <pre>
                <code>{webhookCode}</code>
              </pre>
            </div>
            <p className="doc-note">
              Keep the signing secret on your server. <code>rawBody</code> is
              the unchanged UTF-8 request body, before JSON parsing. An
              authenticated external scheduler must run the watcher/sender. A
              paid event confirms funding; it does not by itself prove merchant
              collection.
            </p>
          </section>
          <section id="recovery" className="doc-section">
            <span className="doc-section-number">06 / BALANCES & RECOVERY</span>
            <h2>Collect the balance. Reconcile the invoice.</h2>
            <div className="balance-examples">
              <div>
                <span>Invoice 100 · Reward 2</span>
                <b>10 deposited</b>
                <p>8 to merchant + 2 reward</p>
              </div>
              <div>
                <span>Same signed order</span>
                <b>500 deposited</b>
                <p>498 to merchant + 2 reward</p>
              </div>
            </div>
            <p>
              The invoice amount does not cap or block collection. Excess funds
              go to the signed merchant, not an inferred customer address. Later
              deposits remain collectable; a fixed reward applies per sweep, not
              per incoming deposit. If a balance cannot cover the reward,
              sponsor collection with an explicit waiver. Zero reward and
              merchant self-collection make one merchant payout.
            </p>
            <h3>Wrong-chain EVM recovery</h3>
            <p>
              Keep the original intent, salt and all immutable terms. Recovery
              requires matching canonical factories, roots, implementation and
              bytecode. The merchant receives assets on the chain where they
              arrived. Foreign-chain/wrong-asset collection defaults to zero
              reward. A separately signed reward quote binds the executing
              chain, actual asset, order digest, one-use nonce, deadline and
              positive minimum merchant receipt.
            </p>
            <div className="docs-callout subtle">
              <ShieldCheck size={20} />
              <p>
                Recovery is not bridging or exchange. Foreign ERC-1271
                authorization is unsupported. Solana and TRON do not share EVM
                deposit addresses. Customer refunds, cancellation and expiry are
                not protocol features; any customer refund needs a separately
                verified merchant process.
              </p>
            </div>
          </section>
          <section id="security" className="doc-section">
            <span className="doc-section-number">07 / TRUST MODEL</span>
            <h2>Know what each layer controls.</h2>
            <div className="trust-cards">
              <div>
                <ShieldCheck size={21} />
                <h3>Signed destination</h3>
                <p>
                  Merchant payout terms are immutable. EVM/TRON have no payout
                  admin or upgrade hooks. Solana’s public program upgrade
                  authority is revoked.
                </p>
              </div>
              <div>
                <Layers3 size={21} />
                <h3>Optional infrastructure</h3>
                <p>
                  The dashboard indexes orders and delivers receipts. It cannot
                  change the payout destination. Preserve exported signed orders
                  for independent execution.
                </p>
              </div>
            </div>
            <p>
              Supported assets are standard transferable fixed-balance
              native/token assets appropriate to each rail. Fee-on-transfer,
              rebasing and frozen assets are unsupported. Public testnet
              validation is not an independent security audit. Network fees,
              rent and executor economics remain the integrator’s
              responsibility.
            </p>
            <Link href="/app" className="m-button m-primary">
              Create your first test order <ArrowUpRight size={16} />
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
