import {
  JsonRpcProvider,
  Contract,
  ZeroAddress,
  Interface,
  getAddress,
} from "ethers";
import { Connection } from "@solana/web3.js";
import { TronWeb } from "tronweb";
import { createHash } from "node:crypto";
import { database, transaction } from "./db";
import { networks, type PublishedNetwork } from "./networks";
import { random } from "./security";
import { solAddresses, nativeSol } from "../lib/payment-model";
import { enqueue } from "./webhooks";
import { publicPayload } from "./payments";
import evm from "../lib/evm-networks.json";
import protocol from "../lib/protocol.json";
import { fundingStatus } from "../lib/payment-status";
const iface = new Interface(protocol.factoryAbi);
export async function recordCollection(
  slug: string,
  event: {
    chain: string;
    hash: string;
    index: number;
    asset: string;
    received: string;
    merchantAmount: string;
    reward: string;
    invoiceAsset: boolean;
  },
) {
  return transaction(async (c) => {
    const id = [event.chain, event.hash, event.index].join(":");
    const { rowCount } = await c.query(
      "INSERT INTO salute_receipts(id,slug,chain,tx_hash,event_index,asset,received,merchant_amount,reward,invoice_asset) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
      [
        id,
        slug,
        event.chain,
        event.hash,
        event.index,
        event.asset,
        event.received,
        event.merchantAmount,
        event.reward,
        event.invoiceAsset,
      ],
    );
    if (!rowCount) return false;
    const {
      rows: [r],
    } = await c.query(
      "UPDATE salute_payments SET collected=collected+$2::numeric,updated_at=now() WHERE slug=$1 RETURNING *",
      [slug, event.invoiceAsset ? event.received : "0"],
    );
    await enqueue(c, r, "payment.collected", {
      ...publicPayload(r),
      collection: event,
    });
    return true;
  });
}
async function updateBalance(slug: string, balance: string) {
  return transaction(async (c) => {
    const {
      rows: [r],
    } = await c.query(
      "SELECT * FROM salute_payments WHERE slug=$1 FOR UPDATE",
      [slug],
    );
    const total = BigInt(r.collected) + BigInt(balance),
      received = total > BigInt(r.received) ? total : BigInt(r.received),
      status = fundingStatus(received, r.intent.terms.amount);
    const changed = received > BigInt(r.received);
    const {
      rows: [next],
    } = await c.query(
      "UPDATE salute_payments SET balance=$2,received=$3,status=$4,updated_at=now() WHERE slug=$1 RETURNING *",
      [slug, balance, String(received), status],
    );
    if (changed) {
      await enqueue(
        c,
        next,
        status === "partially_paid" ? "payment.partially_paid" : "payment.paid",
        publicPayload(next),
      );
      if (status === "overpaid")
        await enqueue(c, next, "payment.overpaid", publicPayload(next));
    }
  });
}
async function scanEvm(n: PublishedNetwork) {
  const p = new JsonRpcProvider(n.rpc, undefined, { cacheTimeout: -1 });
  try {
    if (String((await p.getNetwork()).chainId) !== n.chainId)
      throw Error("Network mismatch.");
    const head = Math.max(0, (await p.getBlockNumber()) - n.confirmations),
      {
        rows: [cursor],
      } = await database().query(
        "SELECT block_number FROM salute_cursors WHERE chain=$1",
        [n.chain],
      );
    const from = cursor
        ? Number(cursor.block_number) + 1
        : Math.max(0, head - 2000),
      to = Math.min(head, from + 1999);
    if (from > to) return;
    const topic = iface.getEvent("PaymentCollected")!.topicHash;
    const logs = await p.getLogs({
      address: n.deployment,
      topics: [topic],
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const e = iface.parseLog(log)!.args;
      const { rows } = await database().query(
        "SELECT * FROM salute_payments WHERE intent->'terms'->>'id'=$1",
        [e.orderId],
      );
      for (const r of rows) {
        const i = r.intent;
        if (
          !Object.hasOwn(evm, i.network.chain) ||
          i.address.toLowerCase() !== String(e.deposit).toLowerCase() ||
          i.terms.merchant.toLowerCase() !== String(e.merchant).toLowerCase() ||
          i.network.deployment.toLowerCase() !== n.deployment.toLowerCase() ||
          i.terms.originChainId !== String(e.originChainId)
        )
          continue;
        await recordCollection(r.slug, {
          chain: n.chain,
          hash: log.transactionHash,
          index: log.index,
          asset: String(e.asset),
          received: String(e.received),
          merchantAmount: String(e.merchantAmount),
          reward: String(e.executorReward),
          invoiceAsset:
            i.network.chain === n.chain &&
            i.terms.token.toLowerCase() === String(e.asset).toLowerCase(),
        });
      }
    }
    await database().query(
      "INSERT INTO salute_cursors(chain,block_number) VALUES($1,$2) ON CONFLICT(chain) DO UPDATE SET block_number=$2",
      [n.chain, to],
    );
  } finally {
    p.destroy();
  }
}
export function solanaEvents(logs: string[], program: string) {
  const stack: string[] = [],
    events: {
      index: number;
      order: string;
      asset: string;
      received: string;
      merchantAmount: string;
      reward: string;
    }[] = [];
  const disc = createHash("sha256")
    .update("event:PaymentCollected")
    .digest()
    .subarray(0, 8);
  let index = 0;
  for (const log of logs) {
    const invoke = /^Program (\S+) invoke/.exec(log),
      end = /^Program (\S+) (success|failed)/.exec(log);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (end) {
      stack.pop();
      continue;
    }
    if (!log.startsWith("Program data: ") || stack.at(-1) !== program) continue;
    const b = Buffer.from(log.slice(14), "base64");
    if (b.length !== 136 || !b.subarray(0, 8).equals(disc)) continue;
    // Event encodes two pubkeys, four u64 quantities and executor pubkey.
    const { PublicKey } = requirePublicKey();
    events.push({
      index: index++,
      order: new PublicKey(b.subarray(8, 40)).toBase58(),
      asset: new PublicKey(b.subarray(40, 72)).toBase58(),
      received: String(b.readBigUInt64LE(80)),
      merchantAmount: String(b.readBigUInt64LE(88)),
      reward: String(b.readBigUInt64LE(96)),
    });
  }
  return events;
}
import { PublicKey } from "@solana/web3.js";
const requirePublicKey = () => ({ PublicKey });
async function scanSolana(r: Record<string, any>, n: PublishedNetwork) {
  const c = new Connection(n.rpc, "finalized"),
    a = solAddresses(n, r.intent.terms),
    signatures = await c.getSignaturesForAddress(
      a.order,
      { limit: 100 },
      "finalized",
    );
  for (const s of signatures.reverse()) {
    if (s.err) continue;
    const {
      rows: [seen],
    } = await database().query(
      "SELECT id FROM salute_receipts WHERE chain=$1 AND tx_hash=$2 LIMIT 1",
      [n.chain, s.signature],
    );
    if (seen) continue;
    const tx = await c.getTransaction(s.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) continue;
    for (const event of solanaEvents(
      tx.meta?.logMessages || [],
      n.deployment,
    )) {
      if (event.order !== a.order.toBase58()) continue;
      const expected =
        r.intent.terms.token === nativeSol ? nativeSol : r.intent.terms.token;
      await recordCollection(r.slug, {
        chain: n.chain,
        hash: s.signature,
        index: event.index,
        asset: event.asset,
        received: event.received,
        merchantAmount: event.merchantAmount,
        reward: event.reward,
        invoiceAsset: event.asset === expected,
      });
    }
  }
  let balance = "0";
  if (r.intent.terms.token === nativeSol) {
    const info = await c.getAccountInfo(a.order),
      reserve =
        info && info.data.length >= 128 ? info.data.readBigUInt64LE(120) : 0n,
      b = BigInt(await c.getBalance(a.vault));
    balance = String(b > reserve ? b - reserve : 0n);
  } else {
    const info = await c.getAccountInfo(a.ata);
    if (info) balance = (await c.getTokenAccountBalance(a.ata)).value.amount;
  }
  await updateBalance(r.slug, balance);
}
async function balanceOrigin(r: Record<string, any>, n: PublishedNetwork) {
  const i = r.intent;
  if (n.chain === "solana") return scanSolana(r, n);
  if (Object.hasOwn(evm, n.chain)) {
    const p = new JsonRpcProvider(n.rpc, undefined, { cacheTimeout: -1 });
    try {
      const block = Math.max(0, (await p.getBlockNumber()) - n.confirmations),
        b =
          i.terms.token === ZeroAddress
            ? await p.getBalance(i.address, block)
            : await new Contract(i.terms.token, protocol.tokenAbi, p).balanceOf(
                i.address,
                { blockTag: block },
              );
      await updateBalance(r.slug, String(b));
    } finally {
      p.destroy();
    }
  } else {
    const w = new TronWeb({ fullHost: n.rpc });
    w.setAddress(n.deployment);
    const b =
      i.asset === "TRX"
        ? await w.trx.getBalance(i.address)
        : await (
            await w.contract().at(i.terms.token)
          )
            .balanceOf(i.address)
            .call({ confirmed: true });
    await updateBalance(r.slug, String(b));
  }
}
async function scanSubmitted(active: Record<string, PublishedNetwork>) {
  const { rows } = await database().query(
    "SELECT t.*,p.intent FROM salute_submitted_transactions t JOIN salute_payments p ON p.slug=t.slug WHERE NOT checked ORDER BY t.created_at LIMIT 40",
  );
  for (const t of rows) {
    const n = active[t.chain];
    if (!n) continue;
    let done = false;
    try {
      if (Object.hasOwn(evm, n.chain)) {
        const p = new JsonRpcProvider(n.rpc, undefined, { cacheTimeout: -1 });
        try {
          const receipt = await p.getTransactionReceipt(t.hash);
          if (
            !receipt ||
            (await p.getBlockNumber()) - receipt.blockNumber < n.confirmations
          )
            continue;
          done = true;
          if (receipt.status === 1)
            for (const l of receipt.logs) {
              if (l.address.toLowerCase() !== n.deployment.toLowerCase())
                continue;
              let e;
              try {
                e = iface.parseLog(l);
              } catch {
                continue;
              }
              if (e?.name !== "PaymentCollected") continue;
              const a = e.args;
              if (
                a.orderId !== t.intent.terms.id ||
                String(a.deposit).toLowerCase() !==
                  t.intent.address.toLowerCase() ||
                String(a.merchant).toLowerCase() !==
                  t.intent.terms.merchant.toLowerCase() ||
                String(a.originChainId) !== t.intent.terms.originChainId ||
                n.deployment.toLowerCase() !==
                  t.intent.network.deployment.toLowerCase()
              )
                continue;
              await recordCollection(t.slug, {
                chain: n.chain,
                hash: t.hash,
                index: l.index,
                asset: String(a.asset),
                received: String(a.received),
                merchantAmount: String(a.merchantAmount),
                reward: String(a.executorReward),
                invoiceAsset:
                  n.chain === t.intent.network.chain &&
                  String(a.asset).toLowerCase() ===
                    t.intent.terms.token.toLowerCase(),
              });
            }
        } finally {
          p.destroy();
        }
      } else if (n.chain === "solana") {
        if (
          t.intent.network.chain !== "solana" ||
          t.intent.network.deployment !== n.deployment
        )
          continue;
        const c = new Connection(n.rpc, "finalized"),
          tx = await c.getTransaction(t.hash, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
        if (!tx) continue;
        done = true;
        if (!tx.meta?.err)
          for (const e of solanaEvents(
            tx.meta?.logMessages || [],
            n.deployment,
          )) {
            if (e.order !== solAddresses(n, t.intent.terms).order.toBase58())
              continue;
            await recordCollection(t.slug, {
              chain: n.chain,
              hash: t.hash,
              index: e.index,
              asset: e.asset,
              received: e.received,
              merchantAmount: e.merchantAmount,
              reward: e.reward,
              invoiceAsset: e.asset === t.intent.terms.token,
            });
          }
      } else {
        if (
          t.intent.network.chain !== "tron" ||
          t.intent.network.deployment !== n.deployment
        )
          continue;
        const w = new TronWeb({ fullHost: n.rpc });
        w.setAddress(n.deployment);
        const tx = (await w.solidityNode.request(
          "walletsolidity/gettransactioninfobyid",
          { value: t.hash.replace(/^0x/, "") },
          "post",
        )) as {
          id?: string;
          receipt?: { result?: string };
          log?: { address: string; topics: string[]; data: string }[];
        };
        if (!tx.id) continue;
        done = true;
        const abi = new Interface(protocol.tronFactoryAbi),
          factory = TronWeb.address.toHex(n.deployment).slice(2).toLowerCase();
        if (tx.receipt?.result === "SUCCESS")
          for (const [index, l] of (tx.log || []).entries()) {
            if (l.address.toLowerCase() !== factory) continue;
            let e;
            try {
              e = abi.parseLog({
                topics: l.topics.map((x: string) => "0x" + x),
                data: "0x" + l.data,
              });
            } catch {
              continue;
            }
            if (
              e?.name !== "PaymentCollected" ||
              e.args.orderId !== t.intent.terms.id
            )
              continue;
            const a = e.args,
              deposit = TronWeb.address.fromHex(
                "41" + String(a.deposit).slice(2),
              ),
              asset = TronWeb.address.fromHex("41" + String(a.asset).slice(2));
            if (
              deposit !== t.intent.address ||
              TronWeb.address.fromHex("41" + String(a.merchant).slice(2)) !==
                t.intent.terms.merchant
            )
              continue;
            await recordCollection(t.slug, {
              chain: n.chain,
              hash: t.hash,
              index,
              asset,
              received: String(a.received),
              merchantAmount: String(a.merchantAmount),
              reward: String(a.executorReward),
              invoiceAsset: asset === t.intent.terms.token,
            });
          }
      }
    } catch {
      /* Retry unavailable receipts. The browser cannot create a confirmed event. */
    }
    if (done)
      await database().query(
        "UPDATE salute_submitted_transactions SET checked=true WHERE slug=$1 AND chain=$2 AND hash=$3",
        [t.slug, t.chain, t.hash],
      );
  }
}
export async function watch() {
  const owner = random(),
    { rowCount } = await database().query(
      "INSERT INTO salute_job_locks(name,owner,locked_until) VALUES('watcher',$1,now()+interval '10 minutes') ON CONFLICT(name) DO UPDATE SET owner=$1,locked_until=now()+interval '10 minutes' WHERE salute_job_locks.locked_until<now()",
      [owner],
    );
  if (!rowCount) return { busy: true };
  let scanned = 0,
    errors = 0;
  try {
    const active = networks();
    for (const n of Object.values(active)) {
      if (Object.hasOwn(evm, n.chain)) {
        try {
          await scanEvm(n);
        } catch {
          errors++;
        }
      }
    }
    await scanSubmitted(active);
    const { rows } = await database().query(
      "SELECT * FROM salute_payments ORDER BY updated_at ASC LIMIT 50",
    );
    for (const r of rows) {
      const n = active[r.intent.network.chain];
      if (!n) continue;
      try {
        await balanceOrigin(r, n);
        scanned++;
      } catch {
        errors++;
        await database().query(
          "UPDATE salute_payments SET updated_at=now() WHERE slug=$1",
          [r.slug],
        );
      }
    }
    await database().query(
      "DELETE FROM salute_sessions WHERE expires_at<now(); DELETE FROM salute_challenges WHERE expires_at<now(); DELETE FROM salute_rate_limits WHERE expires_at<now()",
    );
    return { scanned, errors };
  } finally {
    await database().query(
      "DELETE FROM salute_job_locks WHERE name='watcher' AND owner=$1",
      [owner],
    );
  }
}
