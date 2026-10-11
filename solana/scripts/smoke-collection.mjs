import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnchorProvider, BN, Program, Wallet } from '@anchor-lang/core';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { message, addresses, edInstruction } from './intent.mjs';
const rpc=process.env.SOLANA_RPC_URL || 'http://127.0.0.1:29999';
if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc)) throw Error('Loopback only.');
const c=new Connection(rpc,'confirmed'),domain='00'.repeat(32), merchant=Keypair.generate(),payer=Keypair.generate(),executor=Keypair.generate();
const idl=JSON.parse(readFileSync(new URL('../target/idl/salute_pay.json',import.meta.url))),pid=new PublicKey(idl.address);
const client=k=>new Program(idl,new AnchorProvider(c,new Wallet(k),{commitment:'confirmed'}));
const p=client(payer),e=client(executor);
for(const k of [merchant,payer,executor]){const tx=await c.requestAirdrop(k.publicKey,3e9);await c.confirmTransaction(tx,'confirmed');}
const terms=(mint=SystemProgram.programId,amount=10000000,reward=1000000)=>({id:Keypair.generate().publicKey.toBytes(),merchant:merchant.publicKey,mint,amount,reward});
const regAccounts=t=>({payer:payer.publicKey,merchant:merchant.publicKey,instructions:SYSVAR_INSTRUCTIONS_PUBKEY,...addresses(pid,domain,t),systemProgram:SystemProgram.programId});
const collectAccounts=t=>({order:addresses(pid,domain,t).order,vault:addresses(pid,domain,t).vault,merchant:merchant.publicKey,executor:executor.publicKey,systemProgram:SystemProgram.programId});
const registerSol=(t,ix=edInstruction(merchant,message(pid,domain,t)))=>p.methods.registerSol([...t.id],new BN(t.amount),new BN(t.reward)).accountsStrict(regAccounts(t)).preInstructions([ix]);
const deposit=(t,n)=>sendAndConfirmTransaction(c,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:addresses(pid,domain,t).vault,lamports:n})),[payer]);
const collectSol=(t,waive=false)=>e.methods.collectSol(waive).accountsStrict(collectAccounts(t)).rpc();
const state=t=>p.account.orderState.fetch(addresses(pid,domain,t).order);
for(const received of [3000000,50000000]){
  const t=terms();await deposit(t,received);await registerSol(t).rpc();
  const b=await c.getBalance(merchant.publicKey);await collectSol(t);assert.equal((await c.getBalance(merchant.publicKey))-b,received-1000000);
  await deposit(t,50000);const late=await c.getBalance(merchant.publicKey);await collectSol(t,true);assert.equal((await c.getBalance(merchant.publicKey))-late,50000);
  await assert.rejects(()=>collectSol(t));
  await deposit(t,50000);await assert.rejects(()=>e.methods.collectSol(false).accountsStrict({...collectAccounts(t),merchant:payer.publicKey}).rpc());
  await collectSol(t,true);
}
console.log('PASS SOL partial/overpayment, prefunding rent preservation, immutable merchant, per-sweep rewards, late receipts');
const tiny=terms();await registerSol(tiny).rpc();await deposit(tiny,1);
await assert.rejects(()=>collectSol(tiny));await collectSol(tiny,true);
await deposit(tiny,3000000);await collectSol(tiny);
const invalid=terms();await assert.rejects(()=>registerSol(invalid,edInstruction(payer,message(pid,domain,invalid))).rpc());
await assert.rejects(()=>registerSol(invalid,edInstruction(merchant,message(pid,'11'.repeat(32),invalid))).rpc());
console.log('PASS SOL tiny receipt sponsorship and signature/domain binding');
const intended=await createMint(c,payer,payer.publicKey,null,6), wrong=await createMint(c,payer,payer.publicKey,null,6);
const t=terms(intended,100,2),a=addresses(pid,domain,t);
await p.methods.registerToken([...t.id],new BN(t.amount),new BN(t.reward)).accountsStrict({
  ...regAccounts(t),mint:intended,vaultToken:getAssociatedTokenAddressSync(intended,a.vault,true),tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,
}).preInstructions([edInstruction(merchant,message(pid,domain,t))]).rpc();
const tokenAccounts=async mint=>{
  const v=await getOrCreateAssociatedTokenAccount(c,payer,mint,a.vault,true);
  const m=await getOrCreateAssociatedTokenAccount(c,payer,mint,merchant.publicKey);
  const x=await getOrCreateAssociatedTokenAccount(c,payer,mint,executor.publicKey);
  return {order:a.order,vault:a.vault,mint,vaultToken:v.address,merchant:merchant.publicKey,merchantToken:m.address,executor:executor.publicKey,executorToken:x.address,tokenProgram:TOKEN_PROGRAM_ID};
};
const w=await tokenAccounts(wrong);await mintTo(c,payer,wrong,w.vaultToken,payer,500);
await e.methods.collectToken(false).accountsStrict(w).rpc();assert.equal((await getAccount(c,w.merchantToken)).amount,500n);assert.equal((await getAccount(c,w.executorToken)).amount,0n);
await deposit(t,50000);const nativeBefore=await c.getBalance(merchant.publicKey);await collectSol(t);assert.equal((await c.getBalance(merchant.publicKey))-nativeBefore,50000);
const good=await tokenAccounts(intended);await mintTo(c,payer,intended,good.vaultToken,payer,10);
await assert.rejects(()=>e.methods.collectToken(false).accountsStrict({...good,executorToken:w.executorToken}).rpc());
await e.methods.collectToken(false).accountsStrict(good).rpc();assert.equal((await getAccount(c,good.merchantToken)).amount,8n);assert.equal((await getAccount(c,good.executorToken)).amount,2n);
await mintTo(c,payer,intended,good.vaultToken,payer,1);await e.methods.collectToken(true).accountsStrict(good).rpc();assert.equal((await getAccount(c,good.merchantToken)).amount,9n);assert.equal((await getAccount(c,good.executorToken)).amount,2n);
console.log('PASS SPL wrong-asset/native recovery, executor account binding, partial and late intended-asset collection');

await mintTo(c,payer,intended,good.vaultToken,payer,500);await e.methods.collectToken(false).accountsStrict(good).rpc();assert.equal((await getAccount(c,good.executorToken)).amount,4n);console.log("PASS SPL repeated rewarded sweep");
