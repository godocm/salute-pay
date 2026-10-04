import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { AnchorProvider, Program } from '@anchor-lang/core';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

// Read-only local observer. It owns no key and cannot register, settle, or move funds.
const rpc = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const port = Number(process.env.SOLANA_OBSERVER_PORT || 8790);
const connection = new Connection(rpc, 'confirmed');
const idl = JSON.parse(readFileSync(new URL('../target/idl/salute_pay.json', import.meta.url)));
const programId = new PublicKey(process.env.SOLANA_PROGRAM_ID || idl.address);
if (programId.toBase58() !== idl.address) throw new Error('SOLANA_PROGRAM_ID must match the built program ID.');
const provider = new AnchorProvider(connection, undefined, { commitment: 'confirmed' });
const program = new Program(idl, provider);
const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const replies = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function events(addresses) {
  const batches = await Promise.all(addresses.map(a => connection.getSignaturesForAddress(a, { limit: 12 }, 'confirmed')));
  const unique = [...new Map(batches.flat().map(s => [s.signature, s])).values()].sort((a,b) => a.slot-b.slot).slice(-20);
  return Promise.all(unique.map(async s => {
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    const line = tx?.meta?.logMessages?.find(x => x.startsWith('Program log: Instruction: '));
    const instruction = line?.split('Instruction: ')[1];
    const step = instruction?.startsWith('Register') ? 'prepared' : instruction?.startsWith('Settle') ? 'settled' : instruction?.startsWith('Sweep') ? 'late_sweep' : 'deposit';
    return { step, signature: s.signature, slot: s.slot, time: s.blockTime, status: s.err || tx?.meta?.err ? 'failed' : 'confirmed' };
  }));
}
async function orderView(publicKey, state) {
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), publicKey.toBuffer()], programId);
  const native = state.mint.equals(PublicKey.default);
  const mint = native ? null : state.mint;
  const depositAddress = native ? vault : getAssociatedTokenAddressSync(mint, vault, true);
  const [balanceRaw, decimals, timeline] = await Promise.all([
    native ? connection.getBalance(vault, 'confirmed').then(x => (BigInt(x) - BigInt(state.vaultReserve.toString())).toString())
      : connection.getTokenAccountBalance(depositAddress, 'confirmed').then(x => x.value.amount).catch(() => '0'),
    native ? Promise.resolve(9) : getMint(connection, mint).then(x => x.decimals),
    events([publicKey, depositAddress]),
  ]);
  const balance = BigInt(balanceRaw);
  const amount = BigInt(state.amount.toString());
  const settled = state.settled;
  return {
    network: 'solana', programId: programId.toBase58(), order: publicKey.toBase58(),
    orderId: Buffer.from(state.orderId).toString('hex'), merchant: state.merchant.toBase58(),
    mint: mint?.toBase58() || null, asset: native ? 'SOL' : 'SPL', decimals,
    amount: amount.toString(), executorReward: state.executorReward.toString(),
    vault: vault.toBase58(), depositAddress: depositAddress.toBase58(),
    vaultReserve: state.vaultReserve.toString(), balance: balance.toString(), settled,
    status: settled ? balance > 0n ? 'late_funds' : 'settled' : balance >= amount ? 'ready' : balance > 0n ? 'partial' : 'awaiting',
    timeline,
  };
}
const server = createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return replies(res, 403, { error: 'Unrecognized Host.' });
    if (req.headers.origin && !origins.has(req.headers.origin)) return replies(res, 403, { error: 'Origin is not allowed.' });
    if (req.headers.origin) { res.setHeader('access-control-allow-origin', req.headers.origin); res.setHeader('vary', 'Origin'); }
    if (req.method !== 'GET') return replies(res, 405, { error: 'Read-only observer.' });
    if (req.url === '/api/solana/config') return replies(res, 200, { rpc, programId: programId.toBase58(), mode: 'local-observer' });
    if (req.url !== '/api/solana/orders') return replies(res, 404, { error: 'Not found.' });
    const states = await program.account.orderState.all();
    return replies(res, 200, await Promise.all(states.map(x => orderView(x.publicKey, x.account))));
  } catch (error) { console.error('[solana observer]', error); if (!res.headersSent) replies(res, 500, { error: 'Could not verify Solana chain state.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Read-only Solana observer: http://127.0.0.1:${port} | ${rpc}`));
