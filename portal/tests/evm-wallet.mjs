import assert from "node:assert/strict";
import ganache from "../../node_modules/ganache/dist/node/core.js";
import {
  JsonRpcProvider,
  Wallet,
  ContractFactory,
  Contract,
  ZeroAddress,
} from "ethers";
import { readFile } from "node:fs/promises";
import {
  deterministicProxy,
  deterministicProxyRuntime,
  verifyDeployment,
} from "../../scripts/collection.mjs";
import {
  create,
  act,
  refresh,
  defaults,
  parseLink,
  paymentLink,
  connect,
  saved,
  store,
  recoverEvm,
} from "../node_modules/.cache/salute-intents.mjs";
import { importOrder } from "../node_modules/.cache/salute-platform.mjs";
const server = ganache.server({
  logging: { quiet: true },
  chain: { chainId: 31337, hardfork: "shanghai" },
  wallet: { deterministic: true, defaultBalance: 1000 },
});
await server.listen(0, "127.0.0.1");
const p = new JsonRpcProvider(
    `http://127.0.0.1:${server.address().port}`,
    undefined,
    { cacheTimeout: -1, pollingInterval: 10 },
  ),
  keys = Object.values(server.provider.getInitialAccounts()),
  wallets = keys.map((k) => new Wallet(k.secretKey, p));
const a = JSON.parse(
  await readFile(
    new URL("../../artifacts/PaymentFactory.json", import.meta.url),
  ),
);
let active = 1,
  walletChain = 1,
  switches = 0;
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
};
globalThis.location = { origin: "http://localhost:5173" };
globalThis.window = {
  ethereum: {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [wallets[active].address];
      if (method === "eth_chainId") return "0x" + walletChain.toString(16);
      if (method === "wallet_switchEthereumChain") {
        walletChain = Number(BigInt(params[0].chainId));
        switches++;
        return null;
      }
      if (method === "eth_signTypedData_v4") {
        const data =
          typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        delete data.types.EIP712Domain;
        return wallets[active].signTypedData(
          data.domain,
          data.types,
          data.message,
        );
      }
      if (method === "eth_sendTransaction") {
        const tx = { ...params[0] };
        delete tx.from;
        return (await wallets[active].sendTransaction(tx)).hash;
      }
      return server.provider.request({ method, params });
    },
  },
};
try {
  await p.send("evm_setAccountCode", [
    deterministicProxy,
    deterministicProxyRuntime,
  ]);
  const plan = await verifyDeployment(p, a);
  await (
    await wallets[0].sendTransaction({
      to: deterministicProxy,
      data: plan.data,
    })
  ).wait();
  const n = {
    ...defaults.ethereum,
    rpc: p._getConnection().url,
    chainId: "31337",
    deployment: plan.factory,
  };
  const i = await create(
    n,
    "Wallet flow",
    "0.0000000000000001",
    "0.000000000000000002",
    true,
  );
  assert.equal(i.terms.originChainId, "31337");
  assert.equal(parseLink(paymentLink(i)).address, i.address);
  assert.ok(paymentLink(i).includes("/pay/offline#pay="));
  assert.equal((await importOrder(paymentLink(i))).address, i.address);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/payments/abcdefghijklmnopqrst");
    return Response.json({ ...i, slug: "abcdefghijklmnopqrst" });
  };
  try {
    assert.equal(
      (await importOrder("http://localhost:5173/pay/abcdefghijklmnopqrst"))
        .address,
      i.address,
    );
    await assert.rejects(
      () => importOrder("https://other-site.invalid/pay/abcdefghijklmnopqrst"),
      /from this site/,
    );
    await assert.rejects(
      () => importOrder("broken input"),
      /complete Salute payment link/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  active = 0;
  await act(n, i, "deposit", "0.00000000000000001", () => {});
  let current = await refresh(n, i);
  assert.equal(current.balance, "10");
  active = 2;
  const before = BigInt(
    await p.send("eth_getBalance", [i.terms.merchant, "latest"]),
  );
  await act(n, current, "settle", "", () => {}, wallets[2].address);
  assert.equal(
    BigInt(await p.send("eth_getBalance", [i.terms.merchant, "latest"])) -
      before,
    8n,
  );
  active = 0;
  await act(n, i, "deposit", "0.0000000000000005", () => {});
  active = 2;
  current = await refresh(n, i);
  assert.equal(current.balance, "500");
  await act(n, current, "settle", "", () => {}, wallets[2].address);
  assert.equal(await refresh(n, i).then((x) => x.balance), "0");
  active = 0;
  await act(n, i, "deposit", "0.000000000000000001", () => {});
  active = 2;
  await act(
    n,
    await refresh(n, i),
    "settle",
    "",
    () => {},
    wallets[2].address,
    true,
  );
  await assert.rejects(
    () =>
      recoverEvm(n, i, ZeroAddress, true, () => {}, {
        authorization: { asset: wallets[0].address },
        signature: "0x00",
      }),
    /quote asset differs/,
  );
  active = 0;
  await act(n, i, "deposit", "0.000000000000000004", () => {});
  active = 2;
  const recoveryReceipts = [];
  const recoveredHash = await recoverEvm(n, i, ZeroAddress, true, (r) =>
    recoveryReceipts.push(r),
  );
  assert.equal(recoveryReceipts.at(-1).status, "confirmed");
  assert.equal(recoveryReceipts.at(-1).hash, recoveredHash);
  const reconciled = await refresh(n, {
    ...i,
    settled: false,
    receipts: [
      {
        kind: "settle",
        hash: recoveredHash,
        status: "pending",
        at: new Date().toISOString(),
      },
    ],
  });
  assert.equal(reconciled.receipts[0].status, "confirmed");
  assert.equal(reconciled.settled, true);
  await assert.rejects(
    () => act(n, i, "settle", "", () => {}, wallets[1].address),
    /changed/,
  );
  assert.ok(switches > 0);
  // A blocked browser storage API must not turn a mined transfer into a failure.
  const history = { version: 1, historicalFundedAddress: "preserve-me" };
  storage.set("salute.orders", JSON.stringify([history, i]));
  store(i);
  assert.ok(
    JSON.parse(storage.get("salute.orders")).some(
      (row) => row.historicalFundedAddress === "preserve-me",
    ),
  );
  storage.set("salute.orders", JSON.stringify({ corrupted: true }));
  assert.deepEqual(saved(), []);
  assert.equal(store(i), false);
  storage.set("salute.orders", JSON.stringify([i]));
  globalThis.localStorage.setItem = () => {
    throw Error("Storage quota exceeded");
  };
  active = 0;
  await act(n, i, "deposit", "0.000000000000000003", () => {});
  assert.equal((await refresh(n, i)).balance, "3");
  active = 2;
  await act(
    n,
    await refresh(n, i),
    "settle",
    "",
    () => {},
    wallets[2].address,
    true,
  );
  console.log(
    "PASS EVM wallet client: sign, dedicated link, under/overpayment, repeated reward, tiny sponsored sweep, chain switching and account-change guard",
  );
} finally {
  p.destroy();
  await server.close();
}
