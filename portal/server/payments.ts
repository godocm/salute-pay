import {
  JsonRpcProvider,
  Contract,
  getAddress,
  ZeroAddress,
  keccak256,
} from "ethers";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import nacl from "tweetnacl";
import { TronWeb } from "tronweb";
import {
  paymentSchema,
  solMessage,
  solAddresses,
  nativeSol,
  type Payment,
} from "../lib/payment-model";
import protocol from "../lib/protocol.json";
import { verifyDeployment } from "../lib/collection";
import evm from "../lib/evm-networks.json";
import { networks } from "./networks";
import { transaction, database } from "./db";
import { random, HttpError } from "./security";
import { identity } from "./auth";
import { isBetaNetwork, planAllowsNetwork, planNetworkMessage, planPaymentLimit } from "../lib/plans";
export async function verifyPayment(raw: unknown): Promise<Payment> {
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Invalid signed payment data.");
  const i = parsed.data,
    n = networks()[i.network.chain];
  if (
    !n ||
    n.chainId !== i.network.chainId ||
    n.deployment !== i.network.deployment ||
    n.domain !== i.network.domain
  )
    throw new HttpError(400, "Network is not an activated Salute deployment.");
  if (
    BigInt(i.terms.amount) <= 0n ||
    BigInt(i.terms.amount) >= 2n ** 256n ||
    BigInt(i.terms.executorFee) >= BigInt(i.terms.amount)
  )
    throw new HttpError(400, "Invalid amount or executor reward.");
  if (Object.hasOwn(evm, n.chain)) {
    if (i.terms.originChainId !== n.chainId)
      throw new HttpError(400, "Invalid signed origin chain.");
    const p = new JsonRpcProvider(n.rpc, undefined, { cacheTimeout: -1 });
    try {
      if (String((await p.getNetwork()).chainId) !== n.chainId)
        throw Error("RPC chain mismatch.");
      const plan = await verifyDeployment(p, protocol.factoryArtifact);
      if (!plan.deployed || getAddress(n.deployment) !== plan.factory)
        throw Error("Factory identity mismatch.");
      const c = new Contract(n.deployment, protocol.factoryAbi, p);
      if (
        !(await c.verifyOrder(i.terms, i.signature)) ||
        getAddress(await c.predictAddress(i.terms)) !== getAddress(i.address)
      )
        throw new HttpError(
          400,
          "Invalid EIP-712 signature or deposit address.",
        );
      if (n.chain === "tempo" && i.terms.token === ZeroAddress)
        throw new HttpError(400, "Tempo requires a TIP-20 asset.");
      if (i.terms.token === ZeroAddress) {
        i.decimals = 18;
        i.asset = evm[n.chain as keyof typeof evm].gas;
      } else {
        const t = new Contract(i.terms.token, protocol.tokenAbi, p);
        i.decimals = Number(await t.decimals());
        i.asset = String(await t.symbol()).slice(0, 16);
      }
    } finally {
      p.destroy();
    }
  } else if (n.chain === "solana") {
    if (
      BigInt(i.terms.amount) > 2n ** 64n - 1n ||
      !/^[a-f0-9]{64}$/.test(n.domain)
    )
      throw new HttpError(400, "Invalid Solana terms.");
    const c = new Connection(n.rpc, "confirmed"),
      genesis = await c.getGenesisHash();
    if (
      n.chainId !== "localnet" &&
      genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    )
      throw Error("Solana genesis mismatch.");
    const domain =
      n.chainId === "localnet"
        ? "00".repeat(32)
        : await import("node:crypto").then((x) =>
            x.createHash("sha256").update(genesis).digest("hex"),
          );
    if (domain !== n.domain) throw Error("Solana domain mismatch.");
    const a = solAddresses(n, i.terms),
      info = await c.getAccountInfo(a.program);
    if (!info?.executable) throw Error("Program not deployed.");
    if (
      (i.terms.token === nativeSol ? a.vault : a.ata).toBase58() !==
        i.address ||
      !nacl.sign.detached.verify(
        solMessage(n, i.terms),
        Buffer.from(i.signature.slice(2), "hex"),
        a.merchant.toBytes(),
      )
    )
      throw new HttpError(400, "Invalid Solana signature or address.");
    if (i.terms.token === nativeSol) {
      i.decimals = 9;
      i.asset = "SOL";
    } else {
      i.decimals = (await getMint(c, a.mint)).decimals;
      i.asset = i.terms.token === n.token ? "sUSD" : "SPL token";
      if (!(await c.getAccountInfo(a.ata)))
        throw new HttpError(
          400,
          "Prepare the SPL payment address before publishing.",
        );
    }
  } else {
    const w = new TronWeb({ fullHost: n.rpc });
    w.setAddress(n.deployment);
    const genesis = await w.trx.getBlock(0);
    if (
      n.chainId !== "local" &&
      String(BigInt("0x" + genesis.blockID.slice(-8))) !== n.chainId
    )
      throw Error("TRON chain mismatch.");
    const c = await w.contract(protocol.tronFactoryAbi as never, n.deployment),
      t = [
        i.terms.id,
        i.terms.merchant,
        i.terms.token,
        i.terms.amount,
        i.terms.executorFee,
      ];
    if (
      !(await c.verifyOrder(t, i.signature).call()) ||
      TronWeb.address.fromHex(await c.predictAddress(t).call()) !== i.address
    )
      throw new HttpError(400, "Invalid TIP-712 signature or address.");
    if (
      i.terms.token ===
      TronWeb.address.fromHex("410000000000000000000000000000000000000000")
    ) {
      i.decimals = 6;
      i.asset = "TRX";
    } else {
      const t = await w.contract().at(i.terms.token);
      i.decimals = Number(await t.decimals().call());
      i.asset = String(await t.symbol().call()).slice(0, 16);
    }
  }
  if (!Number.isInteger(i.decimals) || i.decimals < 0 || i.decimals > 18)
    throw new HttpError(400, "Unsupported token precision.");
  return i;
}
export async function publish(raw: unknown, merchant: { id: string }) {
  const i = await verifyPayment(raw);
  if (identity(i.network.chain, i.terms.merchant).id !== merchant.id)
    throw new HttpError(403, "Payment must belong to the signed-in merchant.");
  return transaction(async (c) => {
    const {
      rows: [m],
    } = await c.query("SELECT * FROM salute_merchants WHERE id=$1 FOR UPDATE", [
      merchant.id,
    ]);
    const key = [
      i.network.chain,
      i.network.chainId,
      i.network.deployment,
      i.address,
    ].join(":");
    const {
      rows: [existing],
    } = await c.query("SELECT * FROM salute_payments WHERE order_key=$1", [
      key,
    ]);
    if (existing) return paymentView(existing);
    const beta = isBetaNetwork(networks()[i.network.chain]);
    if (!planAllowsNetwork(m.plan, i.network.chain, beta))
      throw new HttpError(403, planNetworkMessage(i.network.chain));
    if (!beta) {
      const { rows: [usage] } = await c.query(
        "SELECT count(*)::int n FROM salute_payments WHERE merchant_id=$1 AND created_at>=date_trunc('month',now())",
        [m.id],
      );
      if (usage.n >= planPaymentLimit(m.plan))
        throw new HttpError(403, "Monthly payment-link limit reached.");
    }
    const slug = random(),
      webhook = Boolean(i.webhookEnabled && m.webhook_url);
    i.createdAt = new Date().toISOString();
    const {
      rows: [r],
    } = await c.query(
      "INSERT INTO salute_payments(slug,merchant_id,order_key,intent,public_listing,webhook_enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [slug, m.id, key, JSON.stringify(i), i.publicListing !== false, webhook],
    );
    if (webhook)
      await c.query(
        "INSERT INTO salute_webhooks(id,merchant_id,slug,payload) VALUES($1,$2,$3,$4)",
        [
          random(),
          m.id,
          slug,
          JSON.stringify({
            type: "payment.created",
            payment: publicPayload(r),
          }),
        ],
      );
    return paymentView(r);
  });
}
export const publicPayload = (r: Record<string, any>) => ({
  slug: r.slug,
  reference: r.intent.reference,
  chain: r.intent.network.chain,
  chainId: r.intent.network.chainId,
  address: r.intent.address,
  asset: r.intent.terms.token,
  invoiceAmount: r.intent.terms.amount,
  received: r.received,
  collected: r.collected,
  balance: r.balance,
  status: r.status,
});
export const paymentView = (r: Record<string, any>) => ({
  ...r.intent,
  slug: r.slug,
  balance: String(r.balance),
  collected: String(r.collected),
  received: String(r.received),
  settled: BigInt(r.collected) > 0n,
  status: r.status,
  webhookEnabled: r.webhook_enabled,
  publicListing: r.public_listing,
  receipts: [],
});
export async function payment(slug: string) {
  const {
    rows: [r],
  } = await database().query("SELECT * FROM salute_payments WHERE slug=$1", [
    slug,
  ]);
  if (!r) throw new HttpError(404, "Payment link not found.");
  const { rows } = await database().query(
    "SELECT * FROM salute_receipts WHERE slug=$1 ORDER BY created_at DESC LIMIT 30",
    [slug],
  );
  return {
    ...paymentView(r),
    collections: rows.map((x) => ({
      chain: x.chain,
      hash: x.tx_hash,
      asset: x.asset,
      received: x.received,
      merchantAmount: x.merchant_amount,
      reward: x.reward,
      invoiceAsset: x.invoice_asset,
    })),
  };
}
