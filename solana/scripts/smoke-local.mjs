import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnchorProvider, BN, Program, Wallet } from '@anchor-lang/core';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint, getAccount, getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync, mintTo, transferChecked, TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const rpc = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const connection = new Connection(rpc, 'confirmed');
const merchant = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('../../.data/solana/merchant-keypair.json', import.meta.url)))));
const payer = Keypair.generate();
const executor = Keypair.generate();
const idl = JSON.parse(readFileSync(new URL('../target/idl/salute_pay.json', import.meta.url)));
const provider = new AnchorProvider(connection, new Wallet(merchant), { commitment: 'confirmed' });
const program = new Program(idl, provider);
const executorProgram = new Program(idl, new AnchorProvider(connection, new Wallet(executor), { commitment: 'confirmed' }));
const programId = new PublicKey(idl.address);

async function airdrop(key, amount = 2 * LAMPORTS_PER_SOL) {
  const sig = await connection.requestAirdrop(key, amount);
  await connection.confirmTransaction(sig, 'confirmed');
}
function addresses(orderId) {
  const [order] = PublicKey.findProgramAddressSync([Buffer.from('order'), merchant.publicKey.toBuffer(), orderId], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), order.toBuffer()], programId);
  return { order, vault };
}
async function send(from, to, lamports) {
  return sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })), [from]);
}
async function expectFailure(action, label) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  assert.equal(failed, true, `${label} should fail`);
}

await airdrop(payer.publicKey);
await airdrop(executor.publicKey);
console.log('local program:', programId.toBase58());

// Native SOL: partial payment, independent executor, fixed reward, surplus, late sweep.
const solId = Keypair.generate().publicKey.toBuffer();
const { order: solOrder, vault: solVault } = addresses(solId);
const amount = 1_000_000;
const reward = 100_000;
const regSig = await program.methods.registerSol([...solId], new BN(amount), new BN(reward)).accountsStrict({
  merchant: merchant.publicKey, order: solOrder, vault: solVault, systemProgram: SystemProgram.programId,
}).rpc();
assert.equal((await program.account.orderState.fetch(solOrder)).settled, false);
await send(payer, solVault, 400_000);
await expectFailure(() => executorProgram.methods.settleSol().accountsStrict({
  order: solOrder, vault: solVault, merchant: merchant.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).signers([executor]).rpc(), 'partial SOL settlement');
await send(payer, solVault, 700_000);
const beforeSolMerchant = await connection.getBalance(merchant.publicKey);
const beforeSolExecutor = await connection.getBalance(executor.publicKey);
const settleSig = await executorProgram.methods.settleSol().accountsStrict({
  order: solOrder, vault: solVault, merchant: merchant.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).signers([executor]).rpc();
const settleTx = await connection.getTransaction(settleSig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
const settleFee = settleTx.meta.fee;
const afterSolMerchant = await connection.getBalance(merchant.publicKey);
const afterSolExecutor = await connection.getBalance(executor.publicKey);
assert.equal(afterSolMerchant - beforeSolMerchant, 1_100_000 - reward);
assert.equal(afterSolExecutor - beforeSolExecutor, reward - settleFee);
assert.equal((await program.account.orderState.fetch(solOrder)).settled, true);
await expectFailure(() => executorProgram.methods.settleSol().accountsStrict({
  order: solOrder, vault: solVault, merchant: merchant.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).signers([executor]).rpc(), 'repeat SOL settlement');
await send(payer, solVault, 50_000);
const beforeSweep = await connection.getBalance(merchant.publicKey);
const sweepSig = await executorProgram.methods.sweepLateSol().accountsStrict({
  order: solOrder, vault: solVault, merchant: merchant.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).signers([executor]).rpc();
assert.equal((await connection.getBalance(merchant.publicKey)) - beforeSweep, 50_000);
console.log('SOL register/deposit/settle/sweep:', regSig, settleSig, sweepSig);

// Zero reward has one recipient transfer. A caller cannot replace the merchant.
const zeroId = Keypair.generate().publicKey.toBuffer();
const { order: zeroOrder, vault: zeroVault } = addresses(zeroId);
await program.methods.registerSol([...zeroId], new BN(200_000), new BN(0)).accountsStrict({
  merchant: merchant.publicKey, order: zeroOrder, vault: zeroVault, systemProgram: SystemProgram.programId,
}).rpc();
await send(payer, zeroVault, 200_000);
await expectFailure(() => executorProgram.methods.settleSol().accountsStrict({
  order: zeroOrder, vault: zeroVault, merchant: payer.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).rpc(), 'redirected merchant');
const zeroMerchantBefore = await connection.getBalance(merchant.publicKey);
await executorProgram.methods.settleSol().accountsStrict({
  order: zeroOrder, vault: zeroVault, merchant: merchant.publicKey, executor: executor.publicKey,
  systemProgram: SystemProgram.programId,
}).rpc();
assert.equal((await connection.getBalance(merchant.publicKey)) - zeroMerchantBefore, 200_000);
console.log('SOL zero-reward and redirection checks: PASS');

// SPL: precreated ATA receives a plain transfer from an unrelated payer.
const mint = await createMint(connection, merchant, merchant.publicKey, null, 6);
const payerToken = await getOrCreateAssociatedTokenAccount(connection, merchant, mint, payer.publicKey);
const merchantToken = await getOrCreateAssociatedTokenAccount(connection, merchant, mint, merchant.publicKey);
const executorToken = await getOrCreateAssociatedTokenAccount(connection, merchant, mint, executor.publicKey);
await mintTo(connection, merchant, mint, payerToken.address, merchant, 5_000_000);
const tokenId = Keypair.generate().publicKey.toBuffer();
const { order: tokenOrder, vault: tokenVault } = addresses(tokenId);
const vaultToken = getAssociatedTokenAddressSync(mint, tokenVault, true);
const tokenRegSig = await program.methods.registerToken([...tokenId], new BN(2_000_000), new BN(200_000)).accountsStrict({
  merchant: merchant.publicKey, order: tokenOrder, vault: tokenVault, mint, vaultToken,
  tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
}).rpc();
assert.equal((await getAccount(connection, vaultToken)).amount, 0n);
await transferChecked(connection, payer, payerToken.address, mint, vaultToken, payer, 2_500_000, 6);
const beforeMerchantToken = (await getAccount(connection, merchantToken.address)).amount;
const beforeExecutorToken = (await getAccount(connection, executorToken.address)).amount;
const tokenSettleSig = await executorProgram.methods.settleToken().accountsStrict({
  order: tokenOrder, vault: tokenVault, mint, vaultToken, merchant: merchant.publicKey,
  merchantToken: merchantToken.address, executor: executor.publicKey, executorToken: executorToken.address,
  tokenProgram: TOKEN_PROGRAM_ID,
}).signers([executor]).rpc();
assert.equal((await getAccount(connection, merchantToken.address)).amount - beforeMerchantToken, 2_300_000n);
assert.equal((await getAccount(connection, executorToken.address)).amount - beforeExecutorToken, 200_000n);
await transferChecked(connection, payer, payerToken.address, mint, vaultToken, payer, 100_000, 6);
const beforeLateToken = (await getAccount(connection, merchantToken.address)).amount;
const tokenSweepSig = await executorProgram.methods.sweepLateToken().accountsStrict({
  order: tokenOrder, vault: tokenVault, mint, vaultToken, merchant: merchant.publicKey,
  merchantToken: merchantToken.address, executor: executor.publicKey, executorToken: executorToken.address,
  tokenProgram: TOKEN_PROGRAM_ID,
}).signers([executor]).rpc();
assert.equal((await getAccount(connection, merchantToken.address)).amount - beforeLateToken, 100_000n);
console.log('SPL register/deposit/settle/sweep:', tokenRegSig, tokenSettleSig, tokenSweepSig);
console.log('PASS: local SOL and SPL flows');
