import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ganache from 'ganache';
import { JsonRpcProvider,Wallet,ZeroAddress } from 'ethers';
import { compileContracts } from '../scripts/compile-contracts.mjs';
import { deterministicProxy,deterministicProxyRuntime,deploymentPlan } from '../scripts/collection.mjs';
const artifacts=compileContracts(),root=new URL('..',import.meta.url).pathname;
test('CLI dry-run, deterministic deployment, offline portable signing, cross-chain reward and sponsored recovery work end-to-end',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'salute-v4-cli-')),nodes=[];
  const run=(script,env={},args=[])=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[`scripts/${script}.mjs`,...args],{cwd:root,env:{...process.env,PRIVATE_KEY:'',RPC_URL:'',EXPECTED_CHAIN_ID:'',ORDER_FILE:'',REWARD_FILE:'',...env},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>resolve({code,output}));
  });
  const ok=async(...args)=>{const r=await run(...args);assert.equal(r.code,0,r.output);return r.output;};
  try{
    for(const chainId of [11155111,56]){
      const server=ganache.server({logging:{quiet:true},chain:{chainId,hardfork:'shanghai'},wallet:{deterministic:true,defaultBalance:1000}});
      await server.listen(0,'127.0.0.1');const rpc=`http://127.0.0.1:${server.address().port}`,provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1,pollingInterval:10});
      const wallets=Object.values(server.provider.getInitialAccounts()).slice(0,3).map(x=>new Wallet(x.secretKey,provider));
      await provider.send('evm_setAccountCode',[deterministicProxy,deterministicProxyRuntime]);nodes.push({chainId,server,rpc,provider,wallets});
    }
    const [a,b]=nodes,plan=deploymentPlan(artifacts.PaymentFactory);
    const base=n=>({RPC_URL:n.rpc,EXPECTED_CHAIN_ID:String(n.chainId)});
    await ok('deploy-collection',base(a));assert.equal(await a.provider.getCode(plan.factory),'0x');
    await ok('deploy-collection',{...base(a),PRIVATE_KEY:a.wallets[0].privateKey,DEPLOY_OUTPUT:join(dir,'factory-a.json')},['--broadcast']);
    const orderFile=join(dir,'order.json');
    await ok('create-order',{PRIVATE_KEY:a.wallets[1].privateKey,ORIGIN_CHAIN_ID:String(a.chainId),ORDER_AMOUNT:'100',EXECUTOR_FEE:'2',ORDER_OUTPUT:orderFile});
    const envelope=JSON.parse(await readFile(orderFile));assert.equal(envelope.factory,plan.factory);
    await(await b.wallets[0].sendTransaction({to:envelope.deposit,value:500n})).wait();assert.equal(await b.provider.getCode(plan.factory),'0x');
    await ok('deploy-collection',{...base(b),PRIVATE_KEY:b.wallets[0].privateKey,DEPLOY_OUTPUT:join(dir,'factory-b.json')},['--broadcast']);
    const recovery={...base(b),ORDER_FILE:orderFile,RECOVERY_ASSET:'native',EXECUTOR_ADDRESS:b.wallets[2].address};
    await ok('collect',recovery);assert.equal(BigInt(await b.provider.send('eth_getBalance',[envelope.deposit,'latest'])),500n);
    const rewardFile=join(dir,'reward.json');
    await ok('sign-reward',{PRIVATE_KEY:a.wallets[1].privateKey,ORDER_FILE:orderFile,RECOVERY_CHAIN_ID:String(b.chainId),RECOVERY_ASSET:ZeroAddress,EXECUTOR_REWARD:'2',MIN_MERCHANT_RECEIPT:'1',REWARD_OUTPUT:rewardFile});
    const merchantBefore=BigInt(await b.provider.send('eth_getBalance',[envelope.order.merchant,'latest']));
    const mismatch=await run('collect',{...recovery,EXPECTED_CHAIN_ID:'1'});assert.equal(mismatch.code,1);
    await ok('collect',{...recovery,REWARD_FILE:rewardFile,PRIVATE_KEY:b.wallets[2].privateKey},['--broadcast']);
    assert.equal(BigInt(await b.provider.send('eth_getBalance',[envelope.order.merchant,'latest']))-merchantBefore,498n);
    await(await b.wallets[0].sendTransaction({to:envelope.deposit,value:1n})).wait();
    const replay=await run('collect',{...recovery,REWARD_FILE:rewardFile});assert.equal(replay.code,1);
    await ok('collect',{...recovery,WAIVE_REWARD:'true',PRIVATE_KEY:b.wallets[2].privateKey},['--broadcast']);
    assert.equal(BigInt(await b.provider.send('eth_getBalance',[envelope.deposit,'latest'])),0n);
    assert.equal(JSON.parse(await readFile(join(dir,'factory-b.json'))).phase,'complete');
    await ok('deploy-collection',{...base(b),PRIVATE_KEY:b.wallets[0].privateKey,DEPLOY_OUTPUT:join(dir,'factory-b.json')},['--broadcast']);
    assert.equal(JSON.parse(await readFile(join(dir,'factory-b.json'))).phase,'complete');
  }finally{for(const n of nodes){n.provider.destroy();await n.server.close();}await rm(dir,{recursive:true,force:true});}
});
