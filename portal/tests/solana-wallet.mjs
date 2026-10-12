import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { getWallets } from "@wallet-standard/app";
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  create,
  act,
  refresh,
  defaults,
  prepareSolanaPayment,
  mintTestTokens,
} from "../node_modules/.cache/salute-intents.mjs";
const c = new Connection("http://127.0.0.1:29999", "confirmed"),
  keys = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
let active = 0;
for (const k of keys) {
  const sig = await c.requestAirdrop(k.publicKey, 3e9);
  await c.confirmTransaction(sig, "confirmed");
}
const account = (k) => ({
  address: k.publicKey.toBase58(),
  publicKey: k.publicKey.toBytes(),
  chains: ["solana:localnet", "solana:devnet"],
  features: ["solana:signMessage", "solana:signTransaction"],
});
const wallet = {
  version: "1.0.0",
  name: "Salute local Wallet Standard fixture",
  icon: "data:image/svg+xml;base64,",
  chains: ["solana:localnet", "solana:devnet"],
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
      signTransaction: async ({ transaction }) => {
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
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
};
const n = {
  ...defaults.solana,
  rpc: "http://127.0.0.1:29999",
  chainId: "localnet",
  domain: "00".repeat(32),
  deployment: "B2hF4D7ojHWbXkkFmSSApyR3ohuc8RY2bFiQe8z5foTj",
};
try {
  const i = await create(n, "Standard wallet SOL", "0.01", "0.001", true);
  active = 1;
  await act(n, i, "deposit", "0.003", () => {});
  assert.equal((await refresh(n, i)).balance, "3000000");
  active = 2;
  const before = await c.getBalance(keys[0].publicKey);
  await act(n, i, "settle", "", () => {}, keys[2].publicKey.toBase58());
  assert.equal((await c.getBalance(keys[0].publicKey)) - before, 2000000);
  active = 1;
  await act(n, i, "deposit", "0.05", () => {});
  active = 2;
  await act(n, i, "settle", "", () => {}, keys[2].publicKey.toBase58());
  active = 0;
  const tiny = await create(n, "Sponsored tiny SOL", "0.01", "0", true);
  await prepareSolanaPayment(n, tiny);
  active = 1;
  await act(n, tiny, "deposit", "0.000001", () => {});
  active = 2;
  const tinyBefore = await c.getBalance(keys[0].publicKey);
  await act(n, tiny, "settle", "", () => {}, keys[2].publicKey.toBase58());
  assert.equal((await c.getBalance(keys[0].publicKey)) - tinyBefore, 1000);
  const mint = await createMint(c, keys[0], keys[0].publicKey, null, 6);
  n.token = mint.toBase58();
  active = 0;
  const tokenOrder = await create(n, "Standard wallet SPL", "100", "0", false);
  await prepareSolanaPayment(n, tokenOrder);
  const payerAta = await getOrCreateAssociatedTokenAccount(
    c,
    keys[0],
    mint,
    keys[1].publicKey,
  );
  await mintTo(c, keys[0], mint, payerAta.address, keys[0], 500_000_000n);
  active = 1;
  await act(n, tokenOrder, "deposit", "500", () => {});
  active = 2;
  await act(
    n,
    tokenOrder,
    "settle",
    "",
    () => {},
    keys[2].publicKey.toBase58(),
  );
  const merchantAta = await getOrCreateAssociatedTokenAccount(
    c,
    keys[0],
    mint,
    keys[0].publicKey,
  );
  assert.equal((await getAccount(c, merchantAta.address)).amount, 500_000_000n);
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("test-mint-authority")],
    new PublicKey(n.deployment),
  );
  const testMint = await createMint(c, keys[0], authority, null, 6);
  n.token = testMint.toBase58();
  active = 1;
  await mintTestTokens(n);
  active = 2;
  await mintTestTokens(n);
  const mintedAta = await getOrCreateAssociatedTokenAccount(
    c,
    keys[0],
    testMint,
    keys[2].publicKey,
  );
  assert.equal((await getAccount(c, mintedAta.address)).amount, 1000000000n);
  n.token = mint.toBase58();
  await assert.rejects(() => mintTestTokens(n), /public faucet authority/);
  console.log(
    "PASS actual Solana wallet client: Wallet Standard signing, native prefund/atomic registration, under/overpayment, SPL address setup and zero-reward collection",
  );
} finally {
  unregister();
}
