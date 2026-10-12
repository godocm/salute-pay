import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHmac } from "node:crypto";
import { Pool } from "pg";
import ganache from "../../node_modules/ganache/dist/node/core.js";
import { JsonRpcProvider, Wallet, Contract, id, ZeroAddress } from "ethers";
import {
  deterministicProxy,
  deterministicProxyRuntime,
  verifyDeployment,
  domain,
  portableOrderTypes,
} from "../../scripts/collection.mjs";
const url =
  process.env.PLATFORM_TEST_DATABASE_URL ||
  "postgresql://postgres:salute-local-test-only@127.0.0.1:15432/salute_test";
if (!url.includes("@127.0.0.1:15432/salute_test"))
  throw Error("Only the isolated local test PostgreSQL container is allowed.");
const admin = new Pool({ connectionString: url, max: 1 }),
  schema = "salute_test_" + randomBytes(6).toString("hex");
await admin.query(`CREATE SCHEMA ${schema}`);
process.env.DATABASE_URL =
  url + "?options=" + encodeURIComponent("-c search_path=" + schema);
process.env.ALLOW_LOCAL_RPC = "true";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.CRON_SECRET = "local-test-jobs-only";
const servers = [],
  nodes = [];
let cookie = "",
  seq = 0;
const artifact = JSON.parse(
  await readFile(
    new URL("../../artifacts/PaymentFactory.json", import.meta.url),
  ),
);
try {
  for (const [chain, chainId] of [
    ["ethereum", 11155111],
    ["base", 84532],
  ]) {
    const s = ganache.server({
      logging: { quiet: true },
      chain: { chainId, hardfork: "shanghai" },
      wallet: { deterministic: true, defaultBalance: 1000 },
    });
    await s.listen(0, "127.0.0.1");
    servers.push(s);
    const rpc = `http://127.0.0.1:${s.address().port}`,
      p = new JsonRpcProvider(rpc, undefined, {
        cacheTimeout: -1,
        pollingInterval: 10,
      }),
      wallets = Object.values(s.provider.getInitialAccounts())
        .slice(0, 3)
        .map((k) => new Wallet(k.secretKey, p));
    await p.send("evm_setAccountCode", [
      deterministicProxy,
      deterministicProxyRuntime,
    ]);
    const plan = await verifyDeployment(p, artifact);
    await (
      await wallets[0].sendTransaction({
        to: deterministicProxy,
        data: plan.data,
      })
    ).wait();
    nodes.push({
      chain,
      chainId,
      rpc,
      p,
      wallets,
      f: new Contract(plan.factory, artifact.abi, await p.getSigner(2)),
      deployment: plan.factory,
    });
  }
  process.env.SALUTE_NETWORKS_JSON = JSON.stringify({
    networks: Object.fromEntries(
      nodes.map((n) => [
        n.chain,
        {
          chain: n.chain,
          chainId: String(n.chainId),
          rpc: n.rpc,
          deployment: n.deployment,
          token: "",
          domain: "",
          status: "ready",
          environment: "local",
          confirmations: 1,
        },
      ]),
    ),
  });
  const { api, database, watch, sendWebhooks, publicAddress, validateWebhook } =
    await import("../node_modules/.cache/salute-server.mjs");
  await database().query(
    await readFile(
      new URL("../db/migrations/001_main.sql", import.meta.url),
      "utf8",
    ),
  );
  const request = async (path, method = "GET", b, opts = {}) =>
    api(
      new Request(`http://localhost:5173/api/${path}`, {
        method,
        headers: {
          origin: opts.origin || "http://localhost:5173",
          "content-type": "application/json",
          cookie: opts.cookie ?? cookie,
          ...opts.headers,
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      }),
    );
  const ok = async (...args) => {
    const r = await request(...args),
      b = await r.json();
    assert.ok(r.ok, JSON.stringify(b));
    return b;
  };
  const signin = async (wallet) => {
    const c = await ok("auth/challenge", "POST", {
        chain: "ethereum",
        address: wallet.address,
      }),
      sig = await wallet.signMessage(c.message),
      r = await request("auth/verify", "POST", { id: c.id, signature: sig });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await request("auth/verify", "POST", { id: c.id, signature: sig }))
        .status,
      401,
    );
  };
  const a = nodes[0],
    b = nodes[1];
  await signin(a.wallets[1]);
  const me = await ok("me");
  assert.equal(me.plan, "free");
  assert.equal(
    (
      await request("settings", "PUT", {
        webhookUrl: "https://localhost/private",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("settings", "PUT", { webhookUrl: "http://example.com" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "settings",
        "PUT",
        { webhookUrl: "https://example.com" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  await ok("settings", "PUT", {
    webhookUrl: "https://merchant.example.test/events",
  });
  const signed = async (patch) => {
    const terms = {
      id: id(`platform-${++seq}`),
      merchant: a.wallets[1].address,
      token: ZeroAddress,
      amount: "100",
      executorFee: "2",
      originChainId: String(a.chainId),
      ...patch,
    };
    const signature = await a.wallets[1].signTypedData(
      domain(a.deployment, a.chainId),
      portableOrderTypes,
      terms,
    );
    return {
      version: 4,
      network: {
        chain: "ethereum",
        chainId: String(a.chainId),
        deployment: a.deployment,
        token: "",
        domain: "",
      },
      terms,
      address: await a.f.predictAddress(terms),
      signature,
      reference: "Platform invoice",
      asset: "ETH",
      decimals: 18,
      createdAt: new Date().toISOString(),
      publicListing: true,
      webhookEnabled: true,
    };
  };
  const raw = await signed(),
    payment = await ok("payments", "POST", raw);
  assert.ok(payment.slug);
  assert.equal((await ok("payments", "POST", raw)).slug, payment.slug);
  assert.equal((await ok("public-orders")).payments.length, 1);
  const savedCookie = cookie;
  await signin(a.wallets[2]);
  assert.equal((await ok("payments")).payments.length, 0);
  assert.equal((await request("payments", "POST", await signed())).status, 403);
  cookie = savedCookie;
  const spoof = await signed();
  spoof.address = a.wallets[0].address;
  assert.equal((await request("payments", "POST", spoof)).status, 400);
  const balance = (address) =>
    a.p.send("eth_getBalance", [address, "latest"]).then(BigInt);
  const fund = async (n, address, value) => {
    const s = await n.p.getSigner(0);
    await (await s.sendTransaction({ to: address, value })).wait();
  };
  const mine = async () => {
    for (const n of nodes) {
      await n.p.send("evm_mine", []);
      await n.p.send("evm_mine", []);
    }
  };
  await fund(a, payment.address, 10n);
  const before = await balance(a.wallets[1].address);
  const tx1 = await a.f.collect(raw.terms, raw.signature, ZeroAddress, false);
  await tx1.wait();
  await ok(`payments/${payment.slug}/transactions`, "POST", {
    chain: "ethereum",
    hash: tx1.hash,
  });
  await mine();
  await watch();
  let view = await ok(`payments/${payment.slug}`);
  assert.equal(view.received, "10");
  assert.equal(view.status, "partially_paid");
  assert.equal((await balance(a.wallets[1].address)) - before, 8n);
  await fund(a, payment.address, 90n);
  await (
    await a.f.collect(raw.terms, raw.signature, ZeroAddress, false)
  ).wait();
  await mine();
  await watch();
  view = await ok(`payments/${payment.slug}`);
  assert.equal(view.received, "100");
  assert.equal(view.collected, "100");
  assert.equal(view.status, "paid");
  const over = await signed(),
    op = await ok("payments", "POST", over);
  await fund(a, over.address, 500n);
  await (
    await a.f.collect(over.terms, over.signature, ZeroAddress, false)
  ).wait();
  await mine();
  await watch();
  const overView = await ok(`payments/${op.slug}`);
  assert.equal(overView.received, "500");
  assert.equal(overView.status, "overpaid");
  assert.equal(overView.balance, "0");
  await fund(a, over.address, 1n);
  await (
    await a.f.collect(over.terms, over.signature, ZeroAddress, true)
  ).wait();
  await mine();
  await watch();
  const lateView = await ok(`payments/${op.slug}`);
  assert.equal(lateView.received, "501");
  assert.equal(lateView.status, "overpaid");
  const overEvents = await database().query(
    "SELECT payload FROM salute_webhooks WHERE slug=$1",
    [op.slug],
  );
  assert.ok(
    overEvents.rows.some((row) => row.payload.type === "payment.overpaid"),
  );
  assert.ok(overEvents.rows.some((row) => row.payload.type === "payment.paid"));
  const cross = await signed(),
    cp = await ok("payments", "POST", cross);
  await fund(b, cross.address, 500n);
  const bt = await b.f.collect(
    cross.terms,
    cross.signature,
    ZeroAddress,
    false,
  );
  await bt.wait();
  await ok(`payments/${cp.slug}/transactions`, "POST", {
    chain: "base",
    hash: bt.hash,
  });
  await mine();
  await watch();
  const cv = await ok(`payments/${cp.slug}`);
  assert.equal(cv.status, "awaiting");
  assert.equal(cv.collections[0].received, "500");
  assert.equal(cv.collections[0].invoiceAsset, false);
  let deliveries = 0;
  const sender = async (_url, payload, headers) => {
    const expected =
      "v1=" +
      createHmac("sha256", me.webhookSecret)
        .update(`${headers["salute-timestamp"]}.${payload}`)
        .digest("hex");
    assert.equal(headers["salute-signature"], expected);
    assert.equal(headers["salute-event-id"], JSON.parse(payload).id);
    deliveries++;
    return 204;
  };
  const sent = await sendWebhooks(sender);
  assert.ok(sent.delivered > 0);
  assert.equal(sent.delivered, deliveries);
  assert.equal((await sendWebhooks(sender)).attempted, 0);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.throws(() => validateWebhook("https://127.0.0.1/private"));
  // Concurrent publication is serialized per merchant: the free quota cannot be bypassed with simultaneous requests.
  await database().query("DELETE FROM salute_rate_limits");
  const remaining = 17;
  const candidates = await Promise.all(
    Array.from({ length: remaining + 2 }, () => signed()),
  );
  const results = await Promise.all(
    candidates.map((x) => request("payments", "POST", x)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, remaining);
  assert.equal(results.filter((r) => r.status === 403).length, 2);
  assert.equal((await ok("me")).linksThisMonth, 20);
  assert.equal((await request("jobs")).status, 401);
  const authorized = await request("jobs", "GET", undefined, {
    headers: { authorization: "Bearer local-test-jobs-only" },
  });
  assert.equal(authorized.status, 200);
  console.log(
    "PASS platform PostgreSQL integration: wallet sessions/replay/ownership, signed publisher, shared links, concurrent quotas, chain-verified under/over/late/cross-chain receipts, signed webhooks, job authorization and SSRF guards",
  );
  await database().end();
} finally {
  for (const n of nodes) n.p.destroy();
  for (const s of servers) await s.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
