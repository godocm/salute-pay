import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { getWallets } from "@wallet-standard/app";
import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { loadEnvironment } from "../../scripts/testnet-config.mjs";
import { addresses } from "../../solana/scripts/intent.mjs";
import {
  create,
  act,
  refresh,
  defaults,
  prepareSolanaPayment,
  mintTestTokens,
  paymentLink,
  parseLink,
  verify,
} from "../node_modules/.cache/salute-intents.mjs";

if (!process.argv.includes("--broadcast"))
  throw Error("Public Solana tests require explicit --broadcast.");
const env = await loadEnvironment();
const registry = JSON.parse(
  await readFile(new URL("../public/deployments/main.json", import.meta.url)),
);
const r = registry.networks.solana;
if (!r || r.status !== "ready")
  throw Error("Activate a verified Solana Devnet deployment first.");
const c = new Connection(
  env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed",
);
assert.equal(
  await c.getGenesisHash(),
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
);
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(env.SOLANA_DEPLOYER_KEYPAIR_PATH))),
);
const confirmationsOnly = process.argv.includes("--confirmations-only");
const reuseIndex = process.argv.indexOf("--reuse-roles");
if (confirmationsOnly !== (reuseIndex >= 0) || (reuseIndex >= 0 && !process.argv[reuseIndex + 1]))
  throw Error("Confirmation checks require --confirmations-only --reuse-roles <saved test directory>.");
const directory = resolve(confirmationsOnly ? process.argv[reuseIndex + 1] : `.data/testnets/solana-${Date.now()}`);
const keys = confirmationsOnly
  ? await Promise.all([0, 1, 2].map(async i => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve(directory, `test-role-${i}.json`)))))))
  : [Keypair.generate(), Keypair.generate(), Keypair.generate()];
assert.equal(new Set(keys.map(k => k.publicKey.toBase58())).size, 3);
await mkdir(directory, { recursive: true, mode: 0o700 });
for (let i = 0; !confirmationsOnly && i < keys.length; i++)
  await writeFile(
    resolve(directory, `test-role-${i}.json`),
    JSON.stringify(Array.from(keys[i].secretKey)),
    { flag: "wx", mode: 0o600 },
  );
const report = {
  at: new Date().toISOString(),
  chain: "solana",
  chainId: "devnet",
  program: r.deployment,
  token: r.token,
  status: "running",
  checks: [],
  transactions: [],
};
const outputArg = process.argv.indexOf("--output");
const evidence = outputArg >= 0 ? process.argv[outputArg + 1] : new URL(
  confirmationsOnly ? "../../deployments/solana-confirmation-validation.json" : "../../deployments/solana-validation.json",
  import.meta.url,
);
const remember = async (kind, hash) => {
  if (hash && !report.transactions.some((tx) => tx.hash === hash))
    report.transactions.push({ kind, hash });
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
};
let active = 0;
const account = (k) => ({
  address: k.publicKey.toBase58(),
  publicKey: k.publicKey.toBytes(),
  chains: ["solana:devnet"],
  features: ["solana:signMessage", "solana:signTransaction"],
});
const wallet = {
  version: "1.0.0",
  name: "Salute public Wallet Standard test fixture",
  icon: "data:image/svg+xml;base64,",
  chains: ["solana:devnet"],
  get accounts() {
    return [account(keys[active])];
  },
  features: {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => ({ accounts: [account(keys[active])] }),
    },
    "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async ({ message }) => [
        {
          signedMessage: message,
          signature: nacl.sign.detached(message, keys[active].secretKey),
        },
      ],
    },
    "solana:signTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy"],
      signTransaction: async ({ transaction, chain }) => {
        assert.equal(chain, "solana:devnet");
        const tx = Transaction.from(transaction);
        tx.partialSign(keys[active]);
        return [{ signedTransaction: tx.serialize() }];
      },
    },
  },
};
const unregister = getWallets().register(wallet),
  storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.location = { origin: "http://127.0.0.1:5173" };
const n = {
  ...defaults.solana,
  ...r,
  rpc: env.SOLANA_RPC_URL || defaults.solana.rpc,
};
const checkpoint = async (intent) => {
  await writeFile(
    resolve(directory, `${intent.terms.id.slice(2)}.json`),
    JSON.stringify(intent, null, 2),
  );
  return intent;
};
const invoke = async (intent, kind, amount = "", waive = false) => {
  const hash = await act(
    n,
    intent,
    kind,
    amount,
    () => {},
    keys[active].publicKey.toBase58(),
    waive,
  );
  await remember(kind, hash);
  return hash;
};
const tokenBalance = async (mint, owner) =>
  (await getAccount(c, getAssociatedTokenAddressSync(mint, owner))).amount;
try {
  if (confirmationsOnly) {
    active = 0;
    const zero = await checkpoint(await create(n, "Live HTTP confirmation check", "1", "0", false));
    await remember("SPL setup via HTTP confirmation", await prepareSolanaPayment(n, zero));
    const mint = new PublicKey(r.token);
    const before = await tokenBalance(mint, keys[0].publicKey);
    active = 1;
    const payerBefore = await tokenBalance(mint, keys[1].publicKey);
    await remember("public faucet via HTTP confirmation", await mintTestTokens(n));
    assert.equal(await tokenBalance(mint, keys[1].publicKey), payerBefore + 1000000000n);
    await invoke(zero, "deposit", "1");
    active = 2;
    await invoke(zero, "settle");
    assert.equal(await tokenBalance(mint, keys[0].publicKey), before + 1000000n);
    report.checks.push("HTTP signature confirmation for SPL setup, public mint, deposit and settlement", "merchant receives full balance with zero reward");
  } else {
  const funding = new Transaction();
  for (const key of keys)
    funding.add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: key.publicKey,
        lamports: 200000000,
      }),
    );
  await remember(
    "fund separate test roles",
    await sendAndConfirmTransaction(c, funding, [deployer]),
  );
  const sol = await checkpoint(
    await create(n, "Live native SOL collection", "0.01", "0.001", true),
  );
  assert.equal(parseLink(paymentLink(sol)).address, sol.address);
  await assert.rejects(() =>
    verify(n, { ...sol, terms: { ...sol.terms, amount: "11000000" } }),
  );
  await assert.rejects(() =>
    create(
      { ...n, domain: "11".repeat(32) },
      "Wrong domain",
      "0.01",
      "0",
      true,
    ),
  );
  active = 1;
  await invoke(sol, "deposit", "0.003");
  assert.equal((await refresh(n, sol)).balance, "3000000");
  active = 2;
  let before = await c.getBalance(keys[0].publicKey);
  await invoke(sol, "settle");
  assert.equal((await c.getBalance(keys[0].publicKey)) - before, 2000000);
  active = 1;
  await invoke(sol, "deposit", "0.05");
  active = 2;
  before = await c.getBalance(keys[0].publicKey);
  await invoke(sol, "settle");
  assert.equal((await c.getBalance(keys[0].publicKey)) - before, 49000000);
  active = 1;
  await invoke(sol, "deposit", "0.000001");
  active = 2;
  await assert.rejects(() => invoke(sol, "settle"));
  before = await c.getBalance(keys[0].publicKey);
  await invoke(sol, "settle", "", true);
  assert.equal((await c.getBalance(keys[0].publicKey)) - before, 1000);
  report.checks.push(
    "Wallet Standard / Ed25519 signing",
    "native prefunding and atomic registration/collection",
    "SOL underpayment, overpayment and per-sweep reward",
    "tiny late SOL deposit with reward waiver",
    "term and network-domain tampering rejected",
  );
  console.log(
    "Solana Devnet: native under/over/late payment and signature checks passed",
  );

  active = 0;
  const tiny = await checkpoint(
    await create(n, "Live zero-reward SOL", "0.01", "0", true),
  );
  await remember("native sponsored setup", await prepareSolanaPayment(n, tiny));
  active = 1;
  await invoke(tiny, "deposit", "0.000001");
  active = 2;
  before = await c.getBalance(keys[0].publicKey);
  await invoke(tiny, "settle");
  assert.equal((await c.getBalance(keys[0].publicKey)) - before, 1000);

  active = 1;
  await remember("permissionless SPL faucet", await mintTestTokens(n));
  const mint = new PublicKey(r.token);
  assert.equal(await tokenBalance(mint, keys[1].publicKey), 1000000000n);
  active = 0;
  const spl = await checkpoint(
    await create(n, "Live rewarded SPL collection", "100", "2", false),
  );
  await remember(
    "SPL payment-address setup",
    await prepareSolanaPayment(n, spl),
  );
  active = 1;
  await invoke(spl, "deposit", "10");
  active = 2;
  await invoke(spl, "settle");
  assert.equal(await tokenBalance(mint, keys[0].publicKey), 8000000n);
  assert.equal(await tokenBalance(mint, keys[2].publicKey), 2000000n);
  active = 1;
  await invoke(spl, "deposit", "500");
  active = 2;
  await invoke(spl, "settle");
  assert.equal(await tokenBalance(mint, keys[0].publicKey), 506000000n);
  assert.equal(await tokenBalance(mint, keys[2].publicKey), 4000000n);
  active = 1;
  await invoke(spl, "deposit", "1");
  active = 2;
  await invoke(spl, "settle", "", true);
  assert.equal(await tokenBalance(mint, keys[0].publicKey), 507000000n);
  assert.equal(await tokenBalance(mint, keys[2].publicKey), 4000000n);
  report.checks.push(
    "public SPL mint button call",
    "SPL address setup",
    "10 underpayment -> 8 merchant + 2 reward",
    "500 overpayment -> 498 merchant + 2 reward",
    "late sponsored SPL collection",
  );
  console.log(
    "Solana Devnet: public mint and SPL under/over/repeated reward checks passed",
  );

  active = 0;
  const zero = await checkpoint(
    await create(n, "Live zero-reward SPL", "100", "0", false),
  );
  await remember("zero-reward SPL setup", await prepareSolanaPayment(n, zero));
  active = 1;
  await invoke(zero, "deposit", "10");
  active = 2;
  const zeroHash = await invoke(zero, "settle");
  assert.equal(await tokenBalance(mint, keys[0].publicKey), 517000000n);
  assert.equal(await tokenBalance(mint, keys[2].publicKey), 4000000n);
  let parsed;
  for (let i = 0; i < 12; i++) {
    parsed = await c.getParsedTransaction(zeroHash, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (parsed) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  assert.ok(parsed);
  assert.equal(
    (parsed.meta?.innerInstructions || [])
      .flatMap((x) => x.instructions)
      .filter(
        (x) =>
          x.program === "spl-token" && x.parsed?.type === "transferChecked",
      ).length,
    1,
  );
  report.checks.push("zero reward -> one payout transfer");

  const wrong = await createMint(c, keys[1], keys[1].publicKey, null, 6);
  const a = addresses(new PublicKey(r.deployment), r.domain, {
    id: Buffer.from(spl.terms.id.slice(2), "hex"),
    merchant: spl.terms.merchant,
    mint: spl.terms.token,
    amount: spl.terms.amount,
    reward: spl.terms.executorFee,
  });
  const vaultToken = await getOrCreateAssociatedTokenAccount(
    c,
    keys[1],
    wrong,
    a.vault,
    true,
  );
  const merchantToken = await getOrCreateAssociatedTokenAccount(
    c,
    keys[1],
    wrong,
    keys[0].publicKey,
  );
  await remember(
    "wrong-mint deposit",
    await mintTo(c, keys[1], wrong, vaultToken.address, keys[1], 25000000n),
  );
  const meta = (pubkey, isWritable = false, isSigner = false) => ({
    pubkey,
    isWritable,
    isSigner,
  });
  const recovery = new Transaction().add(
    new TransactionInstruction({
      programId: new PublicKey(r.deployment),
      keys: [
        meta(a.order, true),
        meta(a.vault),
        meta(wrong),
        meta(vaultToken.address, true),
        meta(keys[0].publicKey),
        meta(merchantToken.address, true),
        meta(keys[2].publicKey, false, true),
        meta(getAssociatedTokenAddressSync(wrong, keys[2].publicKey), true),
        meta(TOKEN_PROGRAM_ID),
      ],
      data: Buffer.concat([
        createHash("sha256")
          .update("global:collect_token")
          .digest()
          .subarray(0, 8),
        Buffer.from([0]),
      ]),
    }),
  );
  await remember(
    "wrong-mint recovery",
    await sendAndConfirmTransaction(c, recovery, [keys[2]]),
  );
  assert.equal((await getAccount(c, merchantToken.address)).amount, 25000000n);
  assert.equal(
    await c.getAccountInfo(
      getAssociatedTokenAddressSync(wrong, keys[2].publicKey),
    ),
    null,
  );
  report.checks.push(
    "wrong SPL mint -> immutable merchant with no executor reward",
  );
  }
  for (const tx of report.transactions) {
    const result = await c.getTransaction(tx.hash, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert.ok(result);
    assert.equal(result.meta.err, null);
    tx.feeLamports = result.meta.fee;
    tx.computeUnits = result.meta.computeUnitsConsumed;
  }
  report.status = "passed";
  console.log(
    confirmationsOnly ? "Solana Devnet: app HTTP signature confirmation and merchant receipt checks passed" : "Solana Devnet: zero rewards, wrong-mint recovery and public receipt verification passed",
  );
} catch (error) {
  report.status = "failed";
  report.reason = error.code || error.message;
  process.exitCode = 1;
  console.log(
    "Solana public test failed; checkpoint and recorded receipts preserved",
  );
} finally {
  unregister();
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
}
