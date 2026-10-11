import { readFile,writeFile } from 'node:fs/promises';
import { JsonRpcProvider,getAddress } from 'ethers';
import { catalog } from './testnet-config.mjs';
import { verifyDeployment } from './collection.mjs';
import { createRequire } from 'node:module';
const path=process.argv[2];if(!path)throw Error('Pass a complete deployment checkpoint path. No transactions are sent.');
const r=JSON.parse(await readFile(path,'utf8')),chain=r.chain||process.env.DEPLOY_CHAIN;
if(!chain||r.phase!=='complete')throw Error('Complete checkpoint and chain required. Pending state is never activated.');
const rpc=process.env.RPC_URL||r.rpc||catalog[chain]?.rpc;
if(!rpc||new URL(rpc).protocol!=='https:')throw Error('Use a verified public HTTPS RPC.');
if(catalog[chain]){const p=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});try{if(String((await p.getNetwork()).chainId)!==String(r.chainId))throw Error('Chain mismatch.');const plan=await verifyDeployment(p,JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url))));if(!plan.deployed||getAddress(r.factory||r.deployment)!==plan.factory)throw Error('Canonical factory mismatch.');r.deployment=plan.factory;}finally{p.destroy();}}
else if(chain==='solana'){
 const require=createRequire(new URL('../solana/package.json',import.meta.url)),{Connection,PublicKey,Transaction,TransactionInstruction}=require('@solana/web3.js'),{createHash}=await import('node:crypto');
 const c=new Connection(rpc,'confirmed'),genesis=await c.getGenesisHash(),domain=createHash('sha256').update(genesis).digest('hex');if(genesis!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'||r.domain!==domain||r.upgradeAuthority!==null)throw Error('Devnet domain and revoked upgrade authority required.');
 const program=await c.getAccountInfo(new PublicKey(r.deployment));if(!program?.executable)throw Error('Program unavailable.');
 const dataAddress=new PublicKey(program.data.subarray(4,36)),data=await c.getAccountInfo(dataAddress);if(!data||data.data[12]!==0)throw Error('Program remains upgradeable.');
 const tx=new Transaction().add(new TransactionInstruction({programId:new PublicKey(r.deployment),keys:[],data:createHash('sha256').update('global:network_domain').digest().subarray(0,8)}));tx.feePayer=new PublicKey(r.merchant);tx.recentBlockhash=(await c.getLatestBlockhash()).blockhash;const sim=await c.simulateTransaction(tx);if(sim.value.err||Buffer.from(sim.value.returnData?.data[0]||'','base64').toString('hex')!==domain)throw Error('Program domain mismatch.');
}else if(chain==='tron'){
 const require=createRequire(new URL('../tron/package.json',import.meta.url)),{TronWeb}=require('tronweb'),w=new TronWeb({fullHost:rpc});w.setAddress(r.deployment);const block=await w.trx.getBlock(0);if(String(BigInt('0x'+block.blockID.slice(-8)))!==r.chainId)throw Error('TRON chain mismatch.');const abi=JSON.parse(await readFile(new URL('../tron/build/contracts/SaluteTronFactory.json',import.meta.url))).abi;const c=await w.contract(abi,r.deployment),d=await c.eip712Domain().call();if(d.name!=='Salute'||d.version!=='4')throw Error('TRON signature domain mismatch.');
}else throw Error('Unsupported network.');
const target=new URL('../portal/public/deployments/main.json',import.meta.url),registry=JSON.parse(await readFile(target,'utf8'));
registry.networks[chain]={chain,chainId:String(r.chainId),deployment:r.deployment,token:r.token||'',domain:r.domain||'',feeToken:r.feeToken,status:'ready',environment:'testnet',confirmations:2};await writeFile(target,JSON.stringify(registry,null,2)+'\n');console.log(`Activated ${chain} main deployment. No private RPC URLs or keys exported.`);
