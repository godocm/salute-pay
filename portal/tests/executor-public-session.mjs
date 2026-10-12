// Interactive, explicit testnet-only session for checking real queue updates.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Wallet, NonceManager, JsonRpcProvider, FetchRequest, Contract, Interface } from "ethers";
import { loadEnvironment, catalog } from "../../scripts/testnet-config.mjs";
import { act, refresh, defaults, store } from "../node_modules/.cache/salute-intents.mjs";
import { fundingView } from "../lib/payment-status.ts";

if (!process.argv.includes("--broadcast")) throw Error("Explicit --broadcast required.");
const arg = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes("--order") && process.argv.includes("--output"));
const order = JSON.parse(await readFile(arg("--order"))), chain = order.network.chain;
assert.ok(Object.hasOwn(catalog, chain));
assert.equal(order.network.environment, "testnet");
const env = await loadEnvironment(), request = new FetchRequest(env[chain.toUpperCase() + "_RPC_URL"] || catalog[chain].rpc);
request.timeout = 25000;
const p = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, pollingInterval: 1500 });
assert.equal(String((await p.getNetwork()).chainId), order.network.chainId);
const wallet = new Wallet(env[chain.toUpperCase() + "_DEPLOYER_PRIVATE_KEY"] || env.EVM_DEPLOYER_PRIVATE_KEY, p), sender = new NonceManager(wallet);
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) };
globalThis.window = { ethereum: { request: async ({ method, params = [] }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet.address];
  if (method === "eth_chainId") return "0x" + BigInt(order.network.chainId).toString(16);
  if (method === "eth_sendTransaction") {
    const tx = { ...params[0] }; delete tx.from;
    return (await sender.sendTransaction(tx)).hash;
  }
  return p.send(method, params);
} } };
let current = order;
const n = { ...defaults[chain], ...order.network, rpc: request.url }, output = arg("--output"), report = { at: new Date().toISOString(), chain, status: "running", orderAddress: order.address, transactions: [], checks: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
store(current);
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
console.log("Ready: deposit <amount>, settle, status, finish. Testnet assets only.");
try {
  for await (const line of input) {
    const [command, amount] = line.trim().split(/\s+/);
    if (command === "finish") { report.status = "passed"; break; }
    if (command === "status") {
      current = await refresh(n, current);
      console.log(JSON.stringify({ balance: current.balance, funding: fundingView(current, current.terms.amount).label }));
      continue;
    }
    assert.ok(["deposit", "settle"].includes(command));
    current = await refresh(n, current);
    const hash = await act(n, current, command, amount || "", r => {
      const existing = report.transactions.find(x => x.hash === r.hash);
      if (existing) Object.assign(existing, r); else report.transactions.push(r);
      save();
    }, wallet.address);
    const receipt = await p.getTransactionReceipt(hash);
    if (command === "settle") {
      const merchantAmount = receipt.logs.filter(l => l.address.toLowerCase() === current.terms.token.toLowerCase()).reduce((sum, l) => {
        try { const e = transfer.parseLog(l); return e?.args.to.toLowerCase() === current.terms.merchant.toLowerCase() ? sum + e.args.value : sum; } catch { return sum; }
      }, 0n);
      assert.ok(merchantAmount > 0n);
      report.checks.push(`confirmed merchant payout ${merchantAmount}`);
      current = { ...current, settled: true };
    }
    current = await refresh(n, current);
    await writeFile(arg("--order") + ".observed.json", JSON.stringify(current, null, 2));
    report.checks.push(`${command} confirmed`);
    save();
    console.log(JSON.stringify({ command, hash, balance: current.balance, funding: fundingView(current, current.terms.amount).label }));
  }
} catch (error) {
  report.status = "failed"; report.reason = error.shortMessage || error.message; process.exitCode = 1;
  console.log("Session stopped; signed order and pending receipts preserved.");
} finally {
  save(); input.close(); p.destroy();
}
