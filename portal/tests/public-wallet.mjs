import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  Wallet,
  NonceManager,
  JsonRpcProvider,
  Contract,
  FetchRequest,
  Interface,
} from "ethers";
import { fundingStatus } from "../lib/payment-status.ts";
import { loadEnvironment, catalog } from "../../scripts/testnet-config.mjs";
import {
  create,
  mintTestTokens,
  act,
  refresh,
  defaults,
  paymentLink,
  parseLink,
} from "../node_modules/.cache/salute-intents.mjs";
if (!process.argv.includes("--broadcast"))
  throw Error("Public wallet tests require --broadcast");
const chain = process.argv.find((a) => Object.hasOwn(catalog, a)) || "tempo",
  e = await loadEnvironment(),
  r = JSON.parse(
    await readFile(new URL("../public/deployments/main.json", import.meta.url)),
  ).networks[chain],
  request = new FetchRequest(
    e[chain.toUpperCase() + "_RPC_URL"] || catalog[chain].rpc,
  );
request.timeout = 25000;
const p = new JsonRpcProvider(request, undefined, {
    cacheTimeout: -1,
    pollingInterval: 1500,
  }),
  merchant = Wallet.createRandom(),
  payer = new Wallet(
    e[chain.toUpperCase() + "_DEPLOYER_PRIVATE_KEY"] ||
      e.EVM_DEPLOYER_PRIVATE_KEY,
    p,
  ),
  sender = new NonceManager(payer);
let current = merchant,
  transactions = [];
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
};
globalThis.location = { origin: "http://127.0.0.1:5173" };
globalThis.window = {
  ethereum: {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [current.address];
      if (method === "eth_chainId")
        return "0x" + BigInt(r.chainId).toString(16);
      if (method === "eth_signTypedData_v4") {
        const d =
          typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        delete d.types.EIP712Domain;
        return current.signTypedData(d.domain, d.types, d.message);
      }
      if (method === "eth_sendTransaction") {
        const tx = { ...params[0] };
        delete tx.from;
        const result = await sender.sendTransaction(tx);
        transactions.push(result.hash);
        return result.hash;
      }
      return p.send(method, params);
    },
  },
};
const config = { ...defaults[chain], ...r, rpc: p._getConnection().url },
  token = new Contract(
    r.token,
    ["function balanceOf(address) view returns(uint256)"],
    p,
  );
const outputArg = process.argv.indexOf("--output");
const output = outputArg >= 0 ? process.argv[outputArg + 1] : new URL(`../../deployments/${chain}-wallet-validation.json`, import.meta.url);
if (!output) throw Error("--output requires a path");
assert.equal(String((await p.getNetwork()).chainId), String(r.chainId));
assert.equal(r.environment, "testnet");
let result;
let stage = "signing";
try {
  const order = await create(
    config,
    "Public wallet-client proof",
    "100",
    "2",
    false,
  );
  await mkdir(new URL("../../.data/testnets/", import.meta.url), { recursive: true });
  const orderPath = new URL(`../../.data/testnets/ui-${chain}-${order.terms.id.slice(2)}.json`, import.meta.url);
  await writeFile(orderPath, JSON.stringify(order, null, 2), { flag: "wx" });
  assert.equal(parseLink(paymentLink(order)).address, order.address);
  current = payer;
  stage = "mint";
  await mintTestTokens(config);
  stage = "underpayment";
  await act(config, order, "deposit", "10", () => {}, payer.address);
  let updated;
  for (let retry = 0; retry < 12; retry++) {
    updated = await refresh(config, order);
    if (updated.balance === "10000000") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert.equal(updated.balance, "10000000");
  assert.equal(fundingStatus(updated.balance, order.terms.amount), "partially_paid");
  assert.equal(await p.getCode(order.address), "0x", "funding must precede receiver deployment");
  stage = "underpayment settlement";
  const first = await act(config, updated, "settle", "", () => {}, payer.address);
  const receipt = await p.getTransactionReceipt(first);
  const transfers = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const merchantReceipt = (receipt) => receipt.logs.filter(l => l.address.toLowerCase() === r.token.toLowerCase()).reduce((sum, l) => {
    try { const event = transfers.parseLog(l); return event?.args.to.toLowerCase() === merchant.address.toLowerCase() ? sum + event.args.value : sum; } catch { return sum; }
  }, 0n);
  assert.equal(merchantReceipt(receipt), 8000000n);
  assert.notEqual(await p.getCode(order.address), "0x", "first settlement deploys the receiver atomically");
  stage = "overpayment";
  await act(config, order, "deposit", "500", () => {}, payer.address);
  for (let retry = 0; retry < 12; retry++) {
    updated = await refresh(config, { ...order, collected: "10000000", received: "10000000" });
    if (updated.balance === "500000000") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert.equal(updated.balance, "500000000");
  assert.equal(fundingStatus(updated.balance, order.terms.amount), "overpaid");
  stage = "overpayment settlement";
  const second = await act(config, updated, "settle", "", () => {}, payer.address);
  assert.equal(merchantReceipt(await p.getTransactionReceipt(second)), 498000000n);
  result = {
    at: new Date().toISOString(),
    chain,
    status: "passed",
    checks: [
      "same app wallet connector/client paths",
      "merchant EIP-712 signing",
      "separate checkout-link verification",
      "public merchant mint button call",
      "underpayment",
      "overpayment",
      "executor reward",
      "observed funding balance changes from underpaid to overpaid",
      "funding precedes atomic receiver deployment",
      chain === "tempo" ? "receipt confirmation with live mixed Tempo transactions" : "public testnet transaction confirmations",
    ],
    transactions,
  };
  console.log(
    `${chain}: actual public app wallet-client signing/mint/deposit/settlement passed`,
  );
} catch (err) {
  result = {
    at: new Date().toISOString(),
    chain,
    status: "failed",
    reason: err.shortMessage || err.message || err.code,
    stage,
    transactions,
  };
  process.exitCode = 1;
  console.log(
    `${chain}: public wallet-client test failed; recorded receipts preserved`,
  );
} finally {
  await writeFile(
    output,
    JSON.stringify(result, null, 2) + "\n",
  );
  p.destroy();
}
