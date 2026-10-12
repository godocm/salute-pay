import test from "node:test";
import assert from "node:assert/strict";
import {
  executionPreview,
  sameWallet,
  afterConfirmation,
} from "../lib/execution.ts";

const intent = (balance = "10", chain = "ethereum") => ({
  network: { chain },
  balance,
  terms: { merchant: "0xAbC", executorFee: "2" },
  receipts: [],
});
test("executor review handles tiny sponsorship, self collection, and pending receipts", () => {
  assert.equal(executionPreview(intent(), "0xdef", false).merchantAmount, 8n);
  assert.equal(
    executionPreview(intent("1"), "0xdef", false).collectible,
    false,
  );
  assert.equal(executionPreview(intent("1"), "0xdef", true).merchantAmount, 1n);
  assert.equal(
    executionPreview(intent("2"), "0xdef", false).collectible,
    false,
  );
  assert.equal(executionPreview(intent(), "0xabc", false).reward, 0n);
  const pending = {
    ...intent(),
    receipts: [{ kind: "settle", status: "pending" }],
  };
  assert.equal(executionPreview(pending, "0xdef", false).collectible, false);
  pending.receipts[0].status = "failed";
  assert.equal(executionPreview(pending, "0xdef", false).collectible, true);
  assert.equal(sameWallet("solana", "AbC", "abc"), false);
  assert.equal(sameWallet("tron", "TAbC", "Tabc"), false);
});
test("confirmed chain settlement survives independent indexing and RPC outages", async () => {
  const receipt = { hash: "confirmed-on-chain", balance: "0" },
    fail = async () => {
      throw Error("service down");
    };
  let result = await afterConfirmation(receipt, fail, async () => ({
    ...receipt,
    balance: "5",
  }));
  assert.equal(
    result.current.balance,
    "5",
    "late deposits remain visible when reporting fails",
  );
  assert.match(result.warning, /status service/);
  result = await afterConfirmation(receipt, async () => {}, fail);
  assert.equal(result.current.hash, receipt.hash);
  assert.match(result.warning, /chain balance/);
  result = await afterConfirmation(receipt, fail, fail);
  assert.equal(result.current, receipt);
  assert.match(result.warning, /receipt/);
});

test("all eight networks can collect underpayments and overpayments independently of invoice status", async () => {
  const { collectionStatus } = await import("../lib/execution.ts");
  for (const chain of ["ethereum", "base", "arbitrum", "bnb", "tempo", "robinhood", "solana", "tron"]) {
    const partial = { ...intent("10", chain), terms: { ...intent().terms, amount: "100" }, received: "10" };
    assert.equal(collectionStatus(partial).status, "ready", chain);
    assert.equal(executionPreview(partial, "executor", false).collectible, true, chain);
    assert.equal(collectionStatus({ ...partial, balance: "500", received: "510" }).status, "ready", chain);
    assert.equal(collectionStatus({ ...partial, balance: "1" }).status, "sponsor", chain);
    assert.equal(executionPreview({ ...partial, balance: "1" }, "executor", true).collectible, true, chain);
    assert.equal(collectionStatus({ ...partial, balance: "0", settled: true }).status, "collected", chain);
    assert.equal(collectionStatus({ ...partial, balance: "0", settled: true, receipts: [{ kind: "settle", status: "pending" }] }).status, "pending", chain);
  }
});
