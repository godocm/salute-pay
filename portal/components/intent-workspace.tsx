"use client";
import { planAllowsNetwork, planNetworkMessage } from "../lib/plans";
import { executionPreview, afterConfirmation, collectionStatus } from "../lib/execution";
import { cumulativeReceived, fundingProgress, fundingView } from "../lib/payment-status";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  Download,
  RefreshCw,
  ShieldCheck,
  Link2,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Settings2,
  ArrowRight,
} from "lucide-react";
import { AppShell } from "./app-shell";
import { ChainLogo } from "./brand";
import { WalletControl } from "./wallet-control";
import {
  api,
  login,
  publish,
  submitTransaction,
  importOrder,
  type Account,
} from "../lib/platform";
import {
  chains,
  defaults,
  isEvm,
  create,
  act,
  refresh,
  verify,
  saved,
  store,
  state,
  value,
  short,
  intentKey,
  paymentLink,
  configFor,
  prepareSolanaPayment,
  prepareTempoGas,
  mintTestTokens,
  recoverEvm,
  explorer,
  type Chain,
  type Network,
  type Intent,
  type Receipt,
} from "../lib/intents";
const names: Record<Chain, string> = {
  solana: "Solana",
  tempo: "Tempo",
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  robinhood: "Robinhood",
  tron: "TRON",
  bnb: "BNB Chain",
};
function exportOrder(i: Intent) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(i, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `salute-${i.terms.id.slice(2, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Workspace({
  mode = "merchant",
}: {
  mode?: "merchant" | "executor" | "developer";
}) {
  const [configs, setConfigs] = useState<Record<Chain, Network>>(defaults),
    [ready, setReady] = useState<Set<string>>(new Set()),
    [db, setDb] = useState(false),
    [configLoaded, setConfigLoaded] = useState(false),
    [chain, setChain] = useState<Chain>("tempo"),
    [account, setAccount] = useState(""),
    [me, setMe] = useState<Account | null>(null),
    [orders, setOrders] = useState<Intent[]>([]),
    [selected, setSelected] = useState<Intent | null>(null);
  const [reference, setReference] = useState(""),
    [amount, setAmount] = useState(""),
    [reward, setReward] = useState("0"),
    [native, setNative] = useState(false),
    [token, setToken] = useState(""),
    [webhook, setWebhook] = useState(false),
    [listing, setListing] = useState(true),
    [hosted, setHosted] = useState(true),
    [fundedOnly, setFundedOnly] = useState(mode === "executor"),
    [search, setSearch] = useState(""),
    [queueCheckedAt, setQueueCheckedAt] = useState(""),
    [queueWarning, setQueueWarning] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [webhookUrl, setWebhookUrl] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [importText, setImportText] = useState(""),
    [waive, setWaive] = useState(false),
    [review, setReview] = useState(false),
    [reviewedBalance, setReviewedBalance] = useState(""),
    [recoveryChain, setRecoveryChain] = useState<Chain>("base"),
    [recoveryAsset, setRecoveryAsset] = useState(
      "0x0000000000000000000000000000000000000000",
    ),
    [recoveryQuote, setRecoveryQuote] = useState("");
  const lock = useRef(false),
    loadGeneration = useRef(0),
    detail = useRef<HTMLElement>(null),
    selection = useRef(selected),
    refreshingQueue = useRef(false),
    queuedLoad = useRef<(() => Promise<void>) | null>(null),
    n = { ...configs[chain], token: token || configs[chain].token };
  selection.current = selected;
  async function run(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    loadGeneration.current++;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function load() {
    if (refreshingQueue.current) {
      queuedLoad.current = load;
      return;
    }
    refreshingQueue.current = true;
    setRefreshing(true);
    const generation = ++loadGeneration.current;
    try {
      const local = saved();
      let rows = local;
      if (db) {
        const result = await api<{ payments: Intent[] }>(
          mode === "executor" ? "public-orders" : "payments",
        );
        rows = [
          ...result.payments.map((order) => {
            const existing = local.find((row) => intentKey(row) === intentKey(order));
            return {
              ...order,
              receipts: existing?.receipts || order.receipts,
            };
          }),
          ...local.filter((row) => !result.payments.some((order) => intentKey(row) === intentKey(order))),
        ];
      }
      let failures = 0;
      if (mode === "executor") {
        // Bound concurrent RPC calls, including awaiting orders so first deposits appear.
        const active = rows.filter((row) => row.network.chain === chain);
        const checked = new Map<string, Intent>();
        for (let offset = 0; offset < active.length; offset += 4) {
          const batch = active.slice(offset, offset + 4);
          const results = await Promise.allSettled(batch.map((row) => refresh(configFor(row, configs), row, false)));
          if (generation !== loadGeneration.current) return;
          results.forEach((result, index) => {
            if (result.status === "fulfilled") checked.set(intentKey(batch[index]), result.value);
            else {
              failures++;
              checked.set(intentKey(batch[index]), { ...batch[index], verifiedAt: undefined });
            }
          });
        }
        rows = rows.map((row) => checked.get(intentKey(row)) ?? row);
      }
      if (generation !== loadGeneration.current) return;
      if (mode === "executor") rows.filter((row) => row.network.chain === chain).forEach(store);
      setOrders(rows);
      const opened = selection.current;
      const current = opened && rows.find((row) => intentKey(row) === intentKey(opened));
      if (current && current.network.chain === chain) {
        if (current.balance !== opened.balance) setReview(false);
        setSelected(current);
      }
      setQueueCheckedAt(new Date().toISOString());
      setQueueWarning(failures ? `${failures} intent${failures === 1 ? "" : "s"} could not be checked. Displayed balances may be stale; refresh before executing.` : "");
    } finally {
      refreshingQueue.current = false;
      setRefreshing(false);
      const next = queuedLoad.current;
      queuedLoad.current = null;
      if (next && !lock.current) next().catch((e) => setQueueWarning(e.message));
    }
  }
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("chain");
    if (mode === "merchant" && requested && chains.includes(requested as Chain))
      setChain(requested as Chain);
    api<{ networks: Record<string, Network>; databaseConfigured: boolean }>(
      "networks",
    )
      .then((data) => {
        setConfigs({ ...defaults, ...data.networks });
        setReady(new Set(Object.keys(data.networks)));
        setDb(data.databaseConfigured);
        setConfigLoaded(true);
      })
      .catch(() => setError("Could not load network configuration."));
    setOrders(saved());
    api<Account>("me")
      .then((m) => {
        setMe(m);
        setWebhookUrl(m.webhookUrl);
        setWebhook(Boolean(m.webhookUrl));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    setToken(configs[chain].token);
    setNative(false);
    setMe(null);
    setReview(false);
    loadGeneration.current++;
  }, [chain, configs]);
  useEffect(() => {
    if (configLoaded && (mode === "executor" || (db && me)))
      load().catch((e) => setError(e.message));
  }, [configLoaded, db, mode, me, chain, configs]);
  useEffect(() => {
    if (!configLoaded || mode !== "executor") return;
    const timer = setInterval(() => {
      if (!lock.current && document.visibilityState === "visible")
        load().catch((e) => setQueueWarning(e.message));
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && !lock.current)
        load().catch((e) => setQueueWarning(e.message));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [configLoaded, db, mode, chain, configs]);
  async function signedIn() {
    const m = await login(n);
    setMe(m);
    setWebhookUrl(m.webhookUrl);
    setWebhook(Boolean(m.webhookUrl));
    return m;
  }
  async function newPayment() {
    await run("Creating signed payment", async () => {
      if (!ready.has(chain))
        throw Error(
          "This network needs a verified main deployment before creating payments.",
        );
      if (db && hosted) {
        const m = await signedIn();
        if (!planAllowsNetwork(m.plan, chain))
          throw Error(planNetworkMessage(chain));
      }
      let i = await create(n, reference, amount, reward, native);
      i.webhookEnabled = db && hosted && webhook;
      i.publicListing = db && hosted && listing;
      setSelected(i);
      setOrders((o) => [i, ...o.filter((x) => intentKey(x) !== intentKey(i))]);
      if (chain === "solana" && !native) {
        setBusy("Preparing SPL payment address");
        await prepareSolanaPayment(n, i);
      }
      if (db && hosted) {
        try {
          i = await publish(i);
        } catch (e) {
          throw Error(
            `${e instanceof Error ? e.message : "Publication failed."} Your signed order is still available below. Export it or share its offline link.`,
          );
        }
      }
      const backedUp = store(i);
      setSelected(i);
      setOrders((o) => [i, ...o.filter((x) => intentKey(x) !== intentKey(i))]);
      setNotice(
        backedUp
          ? "Payment created. Share its payment link and export a signed-order backup."
          : "Payment created. Browser storage is unavailable; export the signed order now to keep your authorization.",
      );
    });
  }
  async function mintTokens() {
    await run("Minting test payment tokens", async () => {
      const hash = await mintTestTokens(configs[chain]);
      setNotice(
        `1,000 valueless test payment tokens minted to your wallet. Transaction: ${hash}`,
      );
    });
  }
  async function choose(i: Intent) {
    loadGeneration.current++;
    await run("Verifying payment", async () => {
      const current = await refresh(configFor(i, configs), i);
      setChain(i.network.chain);
      setSelected(current);
      setOrders((rows) =>
        rows.map((row) => (intentKey(row) === intentKey(i) ? current : row)),
      );
      setWaive(false);
      setReview(false);
      detail.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }
  async function settle() {
    if (!selected) return;
    const i = selected;
    await run("Settling payment", async () => {
      const config = configFor(i, configs),
        latest = await refresh(config, i);
      setSelected(latest);
      if (latest.balance !== reviewedBalance) {
        setReview(false);
        throw Error(
          "The available balance changed. Review the updated payout before signing.",
        );
      }
      if (executionPreview(latest, account, waive).pending)
        throw Error(
          "A collection is pending. Refresh its receipt before submitting another transaction.",
        );
      if (BigInt(latest.balance) === 0n)
        throw Error("No funded balance to collect.");
      const expected = account;
      if (!expected)
        throw Error("Connect the executor wallet on this payment's network.");
      if (chain !== i.network.chain)
        throw Error("Select the payment's origin network before settlement.");
      const hash = await act(
        config,
        latest,
        "settle",
        "",
        (r) => {
          setSelected((prev) =>
            prev && intentKey(prev) === intentKey(i)
              ? {
                  ...prev,
                  receipts: [
                    ...prev.receipts.filter((x) => x.hash !== r.hash),
                    r,
                  ],
                }
              : prev,
          );
        },
        expected,
        waive,
      );
      const confirmed: Intent = {
        ...latest,
        balance: "0",
        collected: String(BigInt(latest.collected ?? "0") + BigInt(latest.balance)),
        settled: true,
        verifiedAt: undefined,
        receipts: [
          ...(
            saved().find((order) => intentKey(order) === intentKey(i))
              ?.receipts || latest.receipts
          ).filter((r) => r.hash !== hash),
          {
            kind: "settle",
            hash,
            status: "confirmed",
            at: new Date().toISOString(),
            chain: i.network.chain,
          },
        ],
      };
      store(confirmed);
      setSelected(confirmed);
      const { current, warning } = await afterConfirmation(
        confirmed,
        () => submitTransaction(i, i.network.chain, hash),
        () => refresh(config, confirmed),
      );
      setSelected(current);
      setOrders((o) =>
        o.map((x) => (intentKey(x) === intentKey(i) ? current : x)),
      );
      setReview(false);
      setNotice(
        `Collection confirmed. Funds were sent to the fixed merchant. ${warning ? `${warning} Keep the receipt; do not resend to update the dashboard.` : i.slug ? "Receipt verification and enabled webhooks follow the chain watcher." : "This offline order has no hosted accounting or webhooks."}`,
      );
    });
  }
  const i = selected,
    preview = i ? executionPreview(i, account, waive) : null,
    self = preview?.self,
    paidReward = preview?.reward ?? 0n,
    balance = preview?.balance ?? 0n,
    canSettle = Boolean(
      i && preview?.collectible && account && chain === i.network.chain,
    ),
    visibleOrders = orders.filter(
      (order) =>
        order.network.chain === chain &&
        (!fundedOnly || BigInt(order.balance) > 0n) &&
        (!search || `${order.reference} ${order.address} ${order.terms.merchant} ${order.asset}`.toLowerCase().includes(search.toLowerCase())),
    );
  return (
    <AppShell active={mode}>
      <main className="app-main">
        <section className="page-intro">
          <div>
            <span className="eyebrow">
              MERCHANT OWNED · PERMISSIONLESS COLLECTION
            </span>
            <h1>
              {mode === "merchant"
                ? "Payments, on your terms."
                : mode === "executor"
                  ? "Collect. Forward. Earn."
                  : "Connect your infrastructure."}
            </h1>
            <p>
              {mode === "merchant"
                ? "Create a signed order. Share one address. Receive funds directly."
                : mode === "executor"
                  ? "Choose a funded order and settle with your own wallet."
                  : "Manage webhook delivery and integrate signed payment links."}
            </p>
          </div>
          <WalletControl
            network={n}
            disabled={!!busy}
            account={account}
            onAccount={(a) => {
              setAccount(a);
              setReview(false);
              if (!a) setMe(null);
            }}
            onError={setError}
          />
        </section>
        <section className="chain-selector" aria-label="Payment network">
          {[
            "tempo",
            "solana",
            ...chains.filter((x) => !["tempo", "solana"].includes(x)),
          ].map((c) => (
            <button
              key={c}
              className={`chain-card ${chain === c ? "selected" : ""}`}
              aria-pressed={chain === c}
              disabled={!!busy}
              onClick={() => setChain(c as Chain)}
            >
              <span className={`chain-mark ${c}`}>
                <ChainLogo chain={c} />
              </span>
              <span>
                <b>{names[c as Chain]}</b>
                <small>
                  {["tempo", "solana"].includes(c)
                    ? "Primary network"
                    : configs[c as Chain].chainId}
                </small>
              </span>
              <span className={`availability ${ready.has(c) ? "on" : ""}`}>
                {ready.has(c)
                  ? ["31337", "1337", "localnet", "local"].includes(
                      configs[c as Chain].chainId,
                    )
                    ? "Local ready"
                    : "Testnet ready"
                  : "Setup pending"}
              </span>
            </button>
          ))}
        </section>
        {mode === "merchant" && (
          <section className="info-banner" aria-label="Test token faucet">
            <div>
              <b>Testnet payment tokens</b>
              <p>
                Mint 1,000 sUSD on the selected network. Anyone can mint; these
                tokens have no monetary value. Your wallet still needs network
                fees.
              </p>
            </div>
            <button
              className="button secondary"
              disabled={
                !!busy || !account || !ready.has(chain) || !configs[chain].token
              }
              onClick={mintTokens}
            >
              {busy === "Minting test payment tokens"
                ? "Minting…"
                : "Mint test tokens"}
            </button>
          </section>
        )}
        {!configLoaded && (
          <p role="status" className="field-note">
            Loading verified network configuration…
          </p>
        )}
        {configLoaded && !db && (
          <div className="info-banner">
            <AlertCircle size={18} />
            <span>
              Offline mode. Orders stay in this browser and exported links.
              Shared publishing and webhooks require the database connection.
            </span>
          </div>
        )}
        {configLoaded && !ready.has(chain) && (
          <div className="info-banner">
            <ShieldCheck size={18} />
            <span>
              {names[chain]} deployment has not been activated. Configure and
              verify the main contract before accepting funds.
            </span>
          </div>
        )}
        {chain === "tempo" && ready.has(chain) && (
          <div className="info-banner">
            <Wallet size={18} />
            <span>Tempo uses a funded stablecoin for transaction fees.</span>
            <button
              className="text-button"
              disabled={!!busy || !account}
              onClick={() =>
                run("Preparing Tempo gas", async () => {
                  await prepareTempoGas(n);
                  setNotice("Tempo fee token selected.");
                })
              }
            >
              Prepare gas token →
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="feedback error">
            <AlertCircle size={18} />
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="feedback">
            <CheckCircle2 size={18} />
            {notice}
          </div>
        )}
        {busy && (
          <div role="status" className="execution-progress">
            <RefreshCw size={16} /> {busy}… Keep this page open while your
            wallet confirms.
          </div>
        )}
        {mode === "developer" ? (
          <section className="card developer-card">
            <span className="eyebrow">DEVELOPER SETTINGS</span>
            <h2>Webhook destination</h2>
            <p>
              Sign in with your merchant wallet to set a public HTTPS endpoint.
              New payments enable webhooks by default when an endpoint is
              configured.
            </p>
            <button
              className="button secondary"
              disabled={!account || !!busy || !db}
              onClick={() =>
                run("Signing in", async () => {
                  await signedIn();
                })
              }
            >
              {me ? "Refresh merchant session" : "Sign in with wallet"}
            </button>
            <label>
              Webhook URL
              <input
                type="url"
                placeholder="https://your-app.com/api/salute"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={!me || !!busy}
              onClick={() =>
                run("Saving webhook", async () => {
                  const result = await api<{ webhookUrl: string }>("settings", {
                    method: "PUT",
                    body: JSON.stringify({ webhookUrl }),
                  });
                  setMe((m) =>
                    m ? { ...m, webhookUrl: result.webhookUrl } : m,
                  );
                  setWebhook(Boolean(result.webhookUrl));
                  setNotice("Webhook destination saved.");
                })
              }
            >
              Save endpoint
            </button>
            {me && (
              <>
                <label>
                  Signing secret{" "}
                  <span className="muted">Keep this on your server</span>
                  <input type="password" readOnly value={me.webhookSecret} />
                </label>
                <button
                  className="text-button"
                  onClick={() =>
                    run("Copying secret", async () => {
                      await navigator.clipboard.writeText(me.webhookSecret);
                      setNotice("Signing secret copied.");
                    })
                  }
                >
                  Copy secret
                </button>
                <p>
                  Your plan: <b>{me.plan}</b> · {me.linksThisMonth} links
                  created this month. Plan changes require verified billing by
                  the operator.
                </p>
              </>
            )}
            <a className="button secondary" href="/integration.html">
              Read API and webhook docs <ArrowUpRight size={16} />
            </a>
          </section>
        ) : (
          <div className={`workspace-grid ${mode === "executor" ? "executor-workspace" : ""}`}>
            <section className="card list-card">
              <div className="card-title">
                <div>
                  <span className="eyebrow">
                    {mode === "executor"
                      ? "PERMISSIONLESS SETTLEMENT"
                      : "YOUR PAYMENT LINKS"}
                  </span>
                  <h2>
                    {mode === "executor"
                      ? "Execution queue"
                      : "Payment activity"}
                  </h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Refresh payments"
                  disabled={!!busy || refreshing}
                  onClick={() => run("Refreshing payments", load)}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              {mode === "executor" && (
                <>
                  <div className="queue-summary">
                    <div><strong>{orders.filter((o) => o.network.chain === chain && BigInt(o.balance) > 0n).length}</strong><span>Funded intents</span></div>
                    <div><strong>{orders.filter((o) => o.network.chain === chain && o.verifiedAt && collectionStatus(o).status === "ready").length}</strong><span>Ready to execute</span></div>
                    <div><strong>{orders.filter((o) => o.network.chain === chain && collectionStatus(o).status === "sponsor").length}</strong><span>Need sponsorship</span></div>
                  </div>
                  <div className="queue-toolbar">
                    <label className="queue-search">Search intents
                      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference, address or asset" />
                    </label>
                    <label className="check queue-filter">
                      <input type="checkbox" checked={fundedOnly} onChange={(e) => setFundedOnly(e.target.checked)} />
                      Funded only
                    </label>
                  </div>
                  <p className="queue-freshness" role="status">
                    {refreshing ? "Checking chain balances…" : queueCheckedAt ? `Last refreshed ${new Date(queueCheckedAt).toLocaleTimeString()} · Auto-refresh every 20s` : "Loading execution queue…"}
                  </p>
                  {queueWarning && <p className="queue-warning" role="status">{queueWarning}</p>}
                  <div className="queue-columns" aria-hidden="true"><span>Intent / network</span><span>Invoice / available</span><span>Funding / execution</span><span /></div>
                </>
              )}
              {db && mode === "merchant" && !me && (
                <button
                  className="button secondary list-signin"
                  disabled={!account || !!busy}
                  onClick={() =>
                    run("Signing in", async () => {
                      await signedIn();
                      await load();
                    })
                  }
                >
                  Sign in to load your published links
                </button>
              )}
              <div className="order-list">
                {visibleOrders.length === 0 ? (
                  <div className="empty-state">
                    <Link2 size={32} />
                    <h3>
                      {mode === "executor"
                        ? search ? "No matching intents" : refreshing ? "Checking intents…" : `No ${fundedOnly ? "funded " : ""}orders on ${names[chain]} yet`
                        : "Your next payment starts here"}
                    </h3>
                    <p>
                      {mode === "executor"
                        ? search ? "Try another reference, address or asset." : "Import a signed order, or wait for a merchant to publish one."
                        : "Connect your wallet and create a payment link."}
                    </p>
                  </div>
                ) : (
                  visibleOrders.map((o) => (
                    <button
                      aria-pressed={Boolean(i && intentKey(i) === intentKey(o))}
                      className={`order-row ${i && intentKey(i) === intentKey(o) ? "active" : ""}`}
                      key={intentKey(o)}
                      disabled={!!busy}
                      onClick={() => choose(o)}
                    >
                      <div>
                        <b>{o.reference}</b>
                        <small>
                          {names[o.network.chain]} · {short(o.address)}
                        </small>
                      </div>
                      <div>
                        <b>
                          {value(o.terms.amount, o.decimals)} {o.asset}
                        </b>
                        <small>
                          {value(o.balance, o.decimals)} {o.asset} available
                        </small>
                        <small>
                          {value(o.terms.executorFee, o.decimals)} {o.asset} reward / sweep
                        </small>
                      </div>
                      {mode === "executor" ? (
                        <div className="queue-statuses">
                          <span className={`status ${fundingView(o, o.terms.amount).status}`}>
                            {fundingView(o, o.terms.amount).label}
                          </span>
                          <small className={`execution-state ${collectionStatus(o).status}`}>{o.verifiedAt ? collectionStatus(o).label : "Chain check unavailable"}</small>
                        </div>
                      ) : <span className={`status ${state(o)}`}>{state(o)}</span>}
                      <ArrowRight size={16} />
                    </button>
                  ))
                )}
              </div>
              <details className="import-box">
                <summary>Import signed order / payment link</summary>
                <textarea
                  aria-label="Signed order JSON or link"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste signed JSON or offline payment link"
                />
                <button
                  className="button secondary"
                  disabled={!!busy || !importText}
                  onClick={() =>
                    run("Importing order", async () => {
                      const o = await importOrder(importText);
                      await verify(configFor(o, configs), o);
                      const current = await refresh(configFor(o, configs), o);
                      store(current);
                      setOrders((rows) => [
                        current,
                        ...rows.filter((x) => intentKey(x) !== intentKey(o)),
                      ]);
                      setSelected(current);
                      setChain(o.network.chain);
                      setWaive(false);
                      setReview(false);
                      setImportText("");
                      setNotice(
                        "Merchant signature and address verified. Connect an executor wallet on this order's network to collect.",
                      );
                    })
                  }
                >
                  Verify and import
                </button>
              </details>
            </section>
            {mode === "merchant" ? (
              <section className="card create-card">
                <span className="eyebrow">NEW PAYMENT</span>
                <h2>Create a payment link</h2>
                {db && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={hosted}
                        disabled={!!busy}
                        onChange={(e) => setHosted(e.target.checked)}
                      />
                      Publish a hosted payment link
                    </label>
                    <p className="field-note">
                      {hosted
                        ? "Hosted links include shared status and optional webhooks. Free supports Ethereum, Base and Arbitrum; other rails require an operator-activated plan."
                        : "Signed offline links work on every activated rail without a dashboard plan. Export a backup; cumulative history, public discovery and webhooks are unavailable."}
                    </p>
                  </>
                )}
                <label>
                  Payment reference
                  <input
                    placeholder="Invoice #1042"
                    maxLength={80}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  Payment asset
                  <select
                    value={native ? "native" : "token"}
                    onChange={(e) => setNative(e.target.value === "native")}
                  >
                    <option value="token">
                      {chain === "solana"
                        ? "SPL token"
                        : chain === "tempo"
                          ? "TIP-20 token"
                          : "Token"}
                    </option>
                    {chain !== "tempo" && (
                      <option value="native">
                        Native{" "}
                        {chain === "solana"
                          ? "SOL"
                          : chain === "tron"
                            ? "TRX"
                            : "currency"}
                      </option>
                    )}
                  </select>
                </label>
                {!native && (
                  <label>
                    {chain === "solana" ? "Mint address" : "Token contract"}
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={chain === "solana" ? "SPL mint" : "0x…"}
                    />
                  </label>
                )}
                <div className="field-pair">
                  <label>
                    Invoice amount
                    <input
                      inputMode="decimal"
                      placeholder="100"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Reward per sweep
                    <input
                      inputMode="decimal"
                      value={reward}
                      onChange={(e) => setReward(e.target.value)}
                    />
                  </label>
                </div>
                <p className="field-note">
                  Set reward to 0 to sponsor settlement. The executor pays
                  network costs and funds go only to you. Small deposits can use
                  a sponsored sweep.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={listing}
                    disabled={!db || !hosted || !!busy}
                    onChange={(e) => setListing(e.target.checked)}
                  />
                  Publish to the executor queue
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={webhook}
                    disabled={!db || !hosted || !me?.webhookUrl || !!busy}
                    onChange={(e) => setWebhook(e.target.checked)}
                  />
                  Send webhook events
                </label>
                {!me?.webhookUrl && (
                  <a className="text-link" href="/developer">
                    Set your webhook URL in Developer settings →
                  </a>
                )}
                <button
                  className="button primary wide"
                  disabled={
                    !!busy ||
                    !account ||
                    !ready.has(chain) ||
                    !amount ||
                    (!native && !token)
                  }
                  onClick={newPayment}
                >
                  {busy || "Sign & create payment"}
                  <ArrowUpRight size={17} />
                </button>
                <p className="field-note">
                  {chain === "solana" && !native
                    ? "You will also approve SPL payment-address setup and pay its rent. Customer transfers can then use this address."
                    : chain === "solana"
                      ? "SOL order signing is off-chain. Registration and collection can happen atomically after funding; tiny first deposits may need sponsored setup."
                      : "Order signing is off-chain. Receiver deployment happens after funding, during collection."}
                </p>
              </section>
            ) : (
              <section className="card executor-note">
                <ShieldCheck size={30} />
                <h2>Your wallet. Your execution.</h2>
                <p>
                  Any wallet can collect to the signed merchant. Review
                  available balance, reward and destination before submitting.
                </p>
                <p>
                  Rewards apply per sweep. Zero-reward sweeps require you or the
                  merchant to sponsor transaction costs.
                </p>
                <ol className="executor-steps">
                  <li>Select a network and open an order.</li>
                  <li>Refresh its balance and review the fixed payout.</li>
                  <li>
                    Connect your wallet, sign collection and keep the receipt.
                  </li>
                </ol>
                <p className="field-note">
                  The queue checks this network every 20 seconds while visible.
                  Underpaid and overpaid intents can both be executed. A
                  reward is gross revenue, not guaranteed profit after network
                  costs.
                </p>
              </section>
            )}
          </div>
        )}
        {i && mode !== "developer" && (
          <section className="card payment-detail" ref={detail}>
            <div className="card-title">
              <div>
                <span className="eyebrow">SIGNED PAYMENT · {names[i.network.chain]}</span>
                <div className="detail-statuses">
                  <span className={`status ${fundingView(i, i.terms.amount).status}`}>{fundingView(i, i.terms.amount).label}</span>
                  <span className={`status ${collectionStatus(i).status}`}>{collectionStatus(i).label}</span>
                </div>
                <h2>{i.reference}</h2>
              </div>
              <div className="inline-actions">
                <button
                  className="button secondary"
                  onClick={() => exportOrder(i)}
                >
                  <Download size={15} />
                  Export order
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    run("Copying link", async () => {
                      await navigator.clipboard.writeText(paymentLink(i));
                      setNotice("Payment link copied.");
                    })
                  }
                >
                  <Copy size={15} />
                  Copy link
                </button>
                <a
                  className="button primary"
                  href={paymentLink(i)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open payment page <ArrowUpRight size={16} />
                </a>
              </div>
            </div>
            <div className="detail-grid funding-detail-grid">
              <div>
                <span>Invoice amount</span>
                <strong>
                  {value(i.terms.amount, i.decimals)} {i.asset}
                </strong>
              </div>
              <div>
                <span>{i.received !== undefined ? "Total received" : "Observed balance"}</span>
                <strong>{value(cumulativeReceived(i), i.decimals)} {i.asset}</strong>
                <small>{fundingProgress(cumulativeReceived(i), i.terms.amount).remaining > 0n
                  ? `${value(fundingProgress(cumulativeReceived(i), i.terms.amount).remaining, i.decimals)} ${i.asset} under invoice`
                  : fundingProgress(cumulativeReceived(i), i.terms.amount).excess > 0n
                    ? `${value(fundingProgress(cumulativeReceived(i), i.terms.amount).excess, i.decimals)} ${i.asset} over invoice`
                    : "Invoice amount received"}</small>
              </div>
              <div>
                <span>Available to collect</span>
                <strong>
                  {value(i.balance, i.decimals)} {i.asset}
                </strong>
              </div>
              <div>
                <span>Fixed merchant destination</span>
                <code>{i.terms.merchant}</code>
              </div>
            </div>
            <p className="field-note">
              {fundingView(i, i.terms.amount).fromBalance && "Funding status reflects the live balance; cumulative receipt history is unavailable or still updating. "}
              Underpayments and overpayments are collectable. Invoice completion
              is based on cumulative confirmed receipts; a previous sweep does
              not prevent later deposits. Offline orders show current balance
              only and cannot establish cumulative invoice completion.
            </p>
            <p className="field-note">
              <b>
                {names[i.network.chain]} · {state(i)}
              </b>{" "}
              ·{" "}
              {i.verifiedAt
                ? `Chain checked ${new Date(i.verifiedAt).toLocaleTimeString()}`
                : "Refresh to verify the chain balance"}
              . Save the signed order; Salute cannot restore an authorization
              you lose.
            </p>
            {i.network.chain === "solana" &&
              i.terms.token === "11111111111111111111111111111111" && (
                <button
                  className="button secondary"
                  style={{ margin: "0 24px" }}
                  disabled={!!busy || !self}
                  onClick={() =>
                    run("Preparing SOL address", async () => {
                      await prepareSolanaPayment(configFor(i, configs), i);
                      setNotice(
                        "SOL address prepared for small deposits. Vault rent is retained separately.",
                      );
                    })
                  }
                >
                  Sponsor SOL address setup for tiny deposits
                </button>
              )}
            <label className="check">
              <input
                type="checkbox"
                checked={waive}
                disabled={!!busy}
                onChange={(e) => {
                  setWaive(e.target.checked);
                  setReview(false);
                }}
              />
              Sponsor this sweep / waive the reward
            </label>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => choose(i)}
              >
                Refresh chain balance
              </button>
              <button
                className="button primary"
                disabled={!canSettle || !!busy}
                onClick={() => {
                  setReviewedBalance(i.balance);
                  setReview(true);
                }}
              >
                Review settlement
              </button>
            </div>
            {!canSettle && (
              <p className="field-note" role="status">
                {preview?.pending
                  ? "A collection is pending. Refresh chain balance to reconcile its receipt before retrying."
                  : !account
                    ? `Connect an executor wallet on ${names[i.network.chain]} to collect.`
                    : chain !== i.network.chain
                      ? `Select ${names[i.network.chain]} to collect this order.`
                      : balance === 0n
                        ? "No balance available. A collected order can receive later deposits; refresh after funding."
                        : "Balance does not cover the reward and a positive merchant receipt. Sponsor this sweep to collect without a reward."}
              </p>
            )}
            {review && (
              <div
                className="settlement-review"
                role="region"
                aria-label="Settlement review"
              >
                <h3>Confirm payout</h3>
                <p>
                  Estimated merchant receipt{" "}
                  <b>
                    {value(preview?.merchantAmount ?? 0n, i.decimals)} {i.asset}
                  </b>{" "}
                  at <code>{i.terms.merchant}</code>.
                </p>
                <p>
                  Executor receives{" "}
                  <b>
                    {value(paidReward, i.decimals)} {i.asset}
                  </b>{" "}
                  at <code>{account}</code>.
                </p>
                <p>
                  You pay the network transaction costs, including any required
                  Solana account setup. Balance can change before execution;
                  another executor may collect first.{" "}
                  {paidReward === 0n
                    ? "Only the merchant transfer is executed."
                    : "The reward is paid for this successful sweep."}
                </p>
                <button
                  className="button primary"
                  disabled={!canSettle || !!busy}
                  onClick={settle}
                >
                  {busy || "Send & sign settlement"}
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => setReview(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            {isEvm(i.network.chain) && (
              <details className="recovery-box">
                <summary>Recover funds on another EVM network / token</summary>
                <p>
                  Recovery sends funds to the same merchant on the actual chain.
                  It requires the same canonical factory. Foreign-chain and
                  wrong-token sweeps default to sponsorship.
                </p>
                <label>
                  Execution network
                  <select
                    value={recoveryChain}
                    onChange={(e) => setRecoveryChain(e.target.value as Chain)}
                  >
                    {chains.filter(isEvm).map((c) => (
                      <option key={c} value={c}>
                        {names[c]} {ready.has(c) ? "" : "· setup pending"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Actual asset contract
                  <input
                    value={recoveryAsset}
                    onChange={(e) => setRecoveryAsset(e.target.value)}
                  />
                </label>
                <p className="field-note">
                  Use the zero address for native currency. Tempo requires a
                  TIP-20 address.
                </p>
                <label>
                  Optional merchant-signed reward quote
                  <textarea
                    value={recoveryQuote}
                    onChange={(e) => setRecoveryQuote(e.target.value)}
                    placeholder="Paste reward authorization JSON. Leave empty for sponsorship."
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!!busy || !ready.has(recoveryChain)}
                  onClick={() =>
                    run("Recovering payment", async () => {
                      const q = recoveryQuote
                        ? JSON.parse(recoveryQuote)
                        : undefined;
                      const hash = await recoverEvm(
                        configs[recoveryChain],
                        i,
                        recoveryAsset,
                        true,
                        (receipt) => {
                          const entry = { ...receipt, chain: recoveryChain };
                          setSelected((previous) => {
                            if (
                              !previous ||
                              intentKey(previous) !== intentKey(i)
                            )
                              return previous;
                            const next = {
                              ...previous,
                              receipts: [
                                ...previous.receipts.filter(
                                  (r) => r.hash !== entry.hash,
                                ),
                                entry,
                              ],
                            };
                            store(next);
                            return next;
                          });
                        },
                        q,
                      );
                      let warning = "";
                      try {
                        await submitTransaction(i, recoveryChain, hash);
                      } catch {
                        warning =
                          " Status reporting is unavailable; keep the receipt and do not resend.";
                      }
                      setNotice(
                        `Recovery confirmed on ${names[recoveryChain]}.${warning}`,
                      );
                    })
                  }
                >
                  Connect execution wallet & recover
                </button>
              </details>
            )}
            {i.receipts?.map((r) => (
              <div className="receipt" key={`${r.hash}:${r.status}`}>
                <span>
                  {r.kind} · {r.status}
                </span>
                {explorer(
                  r.chain && r.chain !== i.network.chain
                    ? configs[r.chain]
                    : configFor(i, configs),
                  r.hash,
                ) ? (
                  <a
                    href={explorer(
                      r.chain && r.chain !== i.network.chain
                        ? configs[r.chain]
                        : configFor(i, configs),
                      r.hash,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(r.hash)} ↗
                  </a>
                ) : (
                  <code>{short(r.hash)}</code>
                )}
              </div>
            ))}
          </section>
        )}
        <section className="flow-strip">
          <div>
            <span>01</span>
            <h3>Create</h3>
            <p>The merchant signs fixed payout terms.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Pay</h3>
            <p>The customer funds a unique address.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Collect</h3>
            <p>An executor forwards to the merchant.</p>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
