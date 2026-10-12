import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { TronWeb } from "tronweb";
import { loadEnvironment } from "../../scripts/testnet-config.mjs";
import { create, act, refresh, defaults, paymentLink, parseLink } from "../node_modules/.cache/salute-intents.mjs";
import { fundingView } from "../lib/payment-status.ts";

if (!process.argv.includes("--broadcast")) throw Error("Public testnet checks require --broadcast.");
const env = await loadEnvironment();
const { networks: { tron: deployment } } = JSON.parse(await readFile(new URL("../public/deployments/main.json", import.meta.url)));
assert.equal(deployment.environment, "testnet");
const rpc = env.TRON_RPC_URL || "https://nile.trongrid.io";
const payer = new TronWeb({ fullHost: rpc, privateKey: env.TRON_DEPLOYER_PRIVATE_KEY });
const merchantKey = await TronWeb.createAccount();
const merchant = new TronWeb({ fullHost: rpc, privateKey: merchantKey.privateKey });
payer.ready = merchant.ready = true;
let current = merchant;
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) };
globalThis.location = { origin: "http://127.0.0.1:5173" };
globalThis.document = {};
const fixture = {
  isTronLink: true,
  get tronWeb() { return current; },
  request: async ({ method, params }) => {
    if (method === "eth_requestAccounts") return [current.defaultAddress.base58];
    if (method === "wallet_switchEthereumChain") {
      assert.equal(BigInt(params[0].chainId), BigInt(deployment.chainId));
      return null;
    }
    throw Error(`Unsupported fixture method ${method}`);
  },
};
globalThis.window = {
  get tronWeb() { return current; },
  tron: fixture,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
const n = { ...defaults.tron, ...deployment, rpc };
const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : "deployments/tron-wallet-validation.json";
assert.ok(output);
const report = { at: new Date().toISOString(), chain: "tron", status: "running", stage: "signing", checks: [], transactions: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
const invoke = async (i, kind, input = "", waive = false) => {
  report.stage = kind;
  save();
  const hash = await act(n, i, kind, input, receipt => {
    const existing = report.transactions.find(t => t.hash === receipt.hash);
    if (existing) Object.assign(existing, receipt);
    else report.transactions.push(receipt);
    save();
  }, current.defaultAddress.base58, waive);
  await save();
  return hash;
};
const balance = async (i, expected) => {
  let next;
  for (let attempt = 0; attempt < 12; attempt++) {
    next = await refresh(n, i);
    if (next.balance === expected) return next;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  assert.equal(next.balance, expected);
};
try {
  save();
  const order = await create(n, "TRON app wallet-client proof", "100", "2", false);
  assert.equal(parseLink(paymentLink(order)).address, order.address);
  await mkdir(new URL("../../.data/testnets/", import.meta.url), { recursive: true });
  await writeFile(new URL(`../../.data/testnets/ui-tron-${order.terms.id.slice(2)}.json`, import.meta.url), JSON.stringify(order, null, 2), { flag: "wx" });
  current = payer;
  await invoke(order, "mint");
  const token = await payer.contract().at(order.terms.token);
  await invoke(order, "deposit", "10");
  const partial = await balance(order, "10000000");
  assert.equal(fundingView(partial, order.terms.amount).status, "partially_paid");
  const before = BigInt(await token.balanceOf(order.terms.merchant).call());
  await invoke(partial, "settle");
  assert.equal(BigInt(await token.balanceOf(order.terms.merchant).call()) - before, 8000000n);
  report.checks.push("TIP-712 intent signing through app connector", "payment-link verification", "mint/deposit via app client", "underpayment settlement and executor reward");
  await invoke(order, "deposit", "500");
  const excess = await balance(order, "500000000");
  assert.equal(fundingView(excess, order.terms.amount).status, "overpaid");
  const beforeExcess = BigInt(await token.balanceOf(order.terms.merchant).call());
  await invoke(excess, "settle");
  assert.equal(BigInt(await token.balanceOf(order.terms.merchant).call()) - beforeExcess, 498000000n);
  report.checks.push("overpayment settlement", "live funding status changes", "receiver deployed and reused through collect");
  report.status = "passed";
  console.log("TRON Nile: app wallet-client signing, funding and collection passed");
} catch (error) {
  report.status = "failed";
  report.reason = error.shortMessage || error.message || error.code;
  process.exitCode = 1;
  console.log("TRON app wallet-client failed; submitted hashes and signed order preserved");
} finally {
  await save();
}
