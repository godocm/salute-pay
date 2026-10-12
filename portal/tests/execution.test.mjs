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
