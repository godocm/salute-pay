"use client";

import { useState } from "react";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import {
  chains,
  value,
  short,
  intentKey,
  type Intent,
  type Chain,
} from "../lib/intents";
import { fundingView } from "../lib/payment-status";
import { collectionStatus } from "../lib/execution";

const PAGE_SIZE = 10;
export function IntentHistory({
  orders,
  chain,
  executor,
  busy,
  onOpen,
}: {
  orders: Intent[];
  chain: Chain;
  executor: boolean;
  busy: boolean;
  onOpen: (intent: Intent) => void;
}) {
  const [search, setSearch] = useState("");
  const [network, setNetwork] = useState("current");
  const [funding, setFunding] = useState("all");
  const [execution, setExecution] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = orders
    .filter(
      (o) =>
        (network === "all" ||
          o.network.chain === (network === "current" ? chain : network)) &&
        (funding === "all" ||
          fundingView(o, o.terms.amount).status === funding) &&
        (execution === "all" ||
          (execution === "funded"
            ? BigInt(o.balance) > 0n
            : collectionStatus(o).status === execution)) &&
        `${o.reference} ${o.address} ${o.terms.id} ${o.terms.merchant} ${o.asset}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const active =
    search || network !== "current" || funding !== "all" || execution !== "all";
  return (
    <>
      <div className="history-filters">
        <label className="history-search">
          <span>
            <Search size={14} /> Search intents
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Reference, address, asset…"
          />
        </label>
        <label>
          Network
          <select
            value={network}
            onChange={(e) => {
              setNetwork(e.target.value);
              setPage(0);
            }}
          >
            <option value="current">Selected · {chain}</option>
            <option value="all">All networks</option>
            {chains.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payment status
          <select
            value={funding}
            onChange={(e) => {
              setFunding(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All statuses</option>
            <option value="awaiting">Awaiting payment</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="overpaid">Overpaid</option>
          </select>
        </label>
        <label>
          Collection
          <select
            value={execution}
            onChange={(e) => {
              setExecution(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All intents</option>
            <option value="funded">Available balance</option>
            <option value="ready">Ready to collect</option>
            <option value="sponsor">Needs sponsorship</option>
            <option value="collected">Collected</option>
            <option value="pending">Confirming</option>
            <option value="awaiting">Waiting for funds</option>
          </select>
        </label>
      </div>
      <div className="history-meta">
        <span>
          {filtered.length} {filtered.length === 1 ? "intent" : "intents"} ·
          Newest first
        </span>
        {active && (
          <button
            onClick={() => {
              setSearch("");
              setNetwork("current");
              setFunding("all");
              setExecution("all");
              setPage(0);
            }}
          >
            <SlidersHorizontal size={13} /> Reset filters
          </button>
        )}
      </div>
      <div className="history-table-wrap">
        <table className="history-table">
          <caption className="sr-only">
            {executor ? "Executor intent history" : "Payment intent history"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Intent</th>
              <th scope="col">Network</th>
              <th scope="col">Amount</th>
              <th scope="col">Payment status</th>
              <th scope="col">{executor ? "Reward / sweep" : "Created"}</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
              .map((o) => {
                const status = fundingView(o, o.terms.amount);
                return (
                  <tr
                    key={intentKey(o)}
                    onClick={() => {
                      if (!busy) onOpen(o);
                    }}
                    className={busy ? "" : "history-clickable"}
                  >
                    <td>
                      <button
                        disabled={busy}
                        className="intent-open"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(o);
                        }}
                      >
                        {o.reference || "Untitled intent"}
                      </button>
                      <small title={o.address}>{short(o.address)}</small>
                    </td>
                    <td>
                      <span className="history-network">
                        {o.network.chain.toUpperCase()}
                      </span>
                      <small>{o.network.chainId}</small>
                    </td>
                    <td className="history-numeric">
                      <b>
                        {value(o.terms.amount, o.decimals)} {o.asset}
                      </b>
                      <small>{value(o.balance, o.decimals)} available</small>
                    </td>
                    <td>
                      <span className={`status ${status.status}`}>
                        {status.label}
                      </span>
                      {executor && (
                        <small>
                          {o.verifiedAt
                            ? collectionStatus(o).label
                            : "Needs chain check"}
                        </small>
                      )}
                    </td>
                    <td>
                      {executor ? (
                        <span className="history-numeric">
                          {value(o.terms.executorFee, o.decimals)} {o.asset}
                        </span>
                      ) : (
                        <time dateTime={o.createdAt}>
                          {new Date(o.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </time>
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Open ${o.reference} intent details`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(o);
                        }}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-state">
            <Search size={26} />
            <h3>{active ? "No matching intents" : "No intents yet"}</h3>
            <p>
              {active
                ? "Adjust your filters to see more results."
                : executor
                  ? "Published and imported signed orders will appear here."
                  : "Create a payment link to start your history."}
            </p>
          </div>
        )}
      </div>
      <div className="history-pagination">
        <span>
          Page {currentPage + 1} of {pages}
        </span>
        <div>
          <button
            className="button secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            className="button secondary"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
