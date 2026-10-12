import Link from "next/link";
import { ArrowUpRight, Check, Minus, Wallet } from "lucide-react";

type Cell = { text: string; detail?: string; checked?: boolean };
const rows: {
  label: string;
  explanation?: string;
  cells: [Cell, Cell, Cell];
}[] = [
  {
    label: "Infrastructure pricing",
    cells: [
      { text: "Contact the team", detail: "Managed gateway pricing" },
      { text: "0.9% per payment", detail: "Capped at $500 per transaction¹" },
      { text: "Starts at $0", detail: "$49 EVM · $99 all eight chains²" },
    ],
  },
  {
    label: "Keep funds in your own wallet",
    cells: [
      { text: "Platform-managed balance", checked: false },
      { text: "Wallet-to-wallet payments", checked: true },
      { text: "Fixed merchant destination", checked: true },
    ],
  },
  {
    label: "Know which order was paid",
    explanation: "Match customer payments to your invoices.",
    cells: [
      { text: "Dashboard & payment records", checked: true },
      { text: "Payment references & API", checked: true },
      {
        text: "Unique address per order",
        detail: "Partial, extra & repeat deposits",
        checked: true,
      },
    ],
  },
  {
    label: "Who controls the infrastructure?",
    cells: [
      { text: "Salute Bank operates it" },
      { text: "Open protocol + hosted tools" },
      {
        text: "Open protocol + your collector",
        detail: "Optional Salute dashboard",
      },
    ],
  },
  {
    label: "Build directly on public contracts",
    cells: [
      { text: "Managed gateway API", checked: false },
      { text: "Public protocol & SDK", checked: true },
      {
        text: "Public contracts & signed orders",
        detail: "Anyone can create or settle",
        checked: true,
      },
    ],
  },
  {
    label: "No percentage service fee",
    cells: [
      { text: "Ask for your fee schedule" },
      { text: "0.9% service fee", checked: false },
      {
        text: "0% on contract collections",
        detail: "Gas & agreed executor reward are separate",
        checked: true,
      },
    ],
  },
  {
    label: "AML / wallet screening",
    cells: [
      { text: "Yes · managed AML controls", checked: true },
      {
        text: "Optional wallet screening",
        detail: "Included when enabled",
        checked: true,
      },
      { text: "On the roadmap", detail: "Not implemented today" },
    ],
  },
];

export function GatewayComparison() {
  return (
    <section
      id="compare"
      className="gateway-comparison section-width"
      aria-labelledby="comparison-title"
    >
      <div className="comparison-heading">
        <div>
          <span className="m-eyebrow">A CLEARER CHOICE</span>
          <h2 id="comparison-title">
            Keep the convenience.
            <br />
            <em>Keep the control.</em>
          </h2>
        </div>
        <p>
          Payment links are familiar.
          <br />
          What changes is who holds the funds,
          <br className="desktop-break" /> who collects them, and how you pay.
        </p>
      </div>
      <div className="comparison-table-wrap">
        <table className="comparison-table">
          <caption className="sr-only">
            Salute Bank, Request Network and Salute Pay comparison, checked 12
            October 2026.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                What matters
                <br />
                <small>to your business</small>
              </th>
              <th scope="col">
                <span>Custodial gateway</span>
                <strong>Salute Bank</strong>
                <small>Managed payment gateway</small>
              </th>
              <th scope="col">
                <span>Non-custodial gateway</span>
                <strong>Request Network</strong>
                <small>Non-custodial payment service</small>
              </th>
              <th scope="col" className="salute-column">
                <span>Open payment protocol</span>
                <strong>
                  Salute Pay <ArrowUpRight size={20} />
                </strong>
                <small>By Salute Bank</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.label}
                  {row.explanation && <small>{row.explanation}</small>}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className={index === 2 ? "salute-column" : undefined}
                    data-product={
                      ["Salute Bank", "Request", "Salute Pay"][index]
                    }
                  >
                    <div className="comparison-cell">
                      {cell.checked !== undefined && (
                        <span
                          className={
                            cell.checked
                              ? "comparison-check"
                              : "comparison-minus"
                          }
                        >
                          {cell.checked ? (
                            <Check size={14} aria-label="Included" />
                          ) : (
                            <Minus size={14} aria-label="Not included" />
                          )}
                        </span>
                      )}
                      <span>
                        {cell.text}
                        {cell.detail && <small>{cell.detail}</small>}
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="comparison-usecase">
        <Wallet size={23} />
        <div>
          <strong>
            For merchants who want control. For builders who want an open rail.
          </strong>
          <p>
            Accept wallet deposits and exchange withdrawals. Match them to an
            order. Run your own collector or let an independent executor earn
            the reward you authorize.
          </p>
        </div>
        <Link href="/app">
          Try the testnet <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="comparison-notes">
        <p>
          ✓ Included · − Not included in the compared offering. Salute Pay is a
          Beta testnet product. Public protocol access does not make the hosted
          dashboard decentralized.
        </p>
        <p>
          ¹ Request’s 0.9% includes EVM gas; TRON has a separate $3.99 network
          charge. Bridging costs can apply. ² Salute infrastructure starts free:
          20 links on Ethereum/Base/Arbitrum; $49 includes all six EVM rails and
          1,000 links; $99 adds Solana/TRON and unlimited links. Network costs,
          rent and executor rewards are separate. Plans require operator
          activation; billing checkout is not live.
        </p>
        <p>
          Salute Bank’s custody and AML entries describe the operator-provided
          service model; confirm pricing and screening coverage with the team.
          Screening is not a guarantee of legal compliance.
        </p>
        <div>
          <span>Checked 12 Oct 2026</span>
          <a href="https://salutebank.com" target="_blank" rel="noreferrer">
            Salute Bank <ArrowUpRight size={12} />
          </a>
          <a
            href="https://request.network/pricing/"
            target="_blank"
            rel="noreferrer"
          >
            Request pricing & screening <ArrowUpRight size={12} />
          </a>
          <a href="https://request.network/" target="_blank" rel="noreferrer">
            Request protocol <ArrowUpRight size={12} />
          </a>
          <Link href="/docs">
            Salute implementation <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
