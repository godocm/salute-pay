import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { JsonRpcProvider, Wallet } from 'ethers';
import { verifyDeployment, factorySalt, deterministicProxy } from './collection.mjs';
const broadcast=process.argv.includes('--broadcast');
async function main(){
  if(!process.env.RPC_URL || !process.env.EXPECTED_CHAIN_ID)throw Error('Set RPC_URL and EXPECTED_CHAIN_ID. Compile contracts first.');
  const p=new JsonRpcProvider(process.env.RPC_URL,undefined,{cacheTimeout:-1});
  try{
    const chainId=String((await p.getNetwork()).chainId);
    if(chainId!==process.env.EXPECTED_CHAIN_ID)throw Error('RPC chain mismatch.');
    const artifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url)));
    const plan=await verifyDeployment(p,artifact);
    console.log(JSON.stringify({chainId,factory:plan.factory,implementation:plan.implementation,initCodeHash:plan.initCodeHash,deployed:plan.deployed,broadcast},null,2));
    if(plan.deployed || !broadcast)return;
    if(!process.env.PRIVATE_KEY)throw Error('Broadcast requires PRIVATE_KEY for the funded deployer.');
    const path=resolve(process.env.DEPLOY_OUTPUT || `.data/deployments/collection-main-${chainId}.json`);
    await mkdir(dirname(path),{recursive:true});
    const record={version:4,chainId,factory:plan.factory,implementation:plan.implementation,proxy:deterministicProxy,salt:factorySalt,initCodeHash:plan.initCodeHash,phase:'prepared'};
    // Preserve previous checkpoints; do not remint tokens or overwrite deployment records.
    await writeFile(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    const signer=new Wallet(process.env.PRIVATE_KEY,p);
    const tx=await signer.sendTransaction({to:deterministicProxy,data:plan.data});
    record.phase='pending';record.transactionHash=tx.hash;await writeFile(path,JSON.stringify(record,null,2)+'\n');
    await tx.wait();await verifyDeployment(p,artifact);
    record.phase='complete';await writeFile(path,JSON.stringify(record,null,2)+'\n');
    console.log('Canonical main factory verified. No token issuance performed.');
  }finally{p.destroy();}
}
main().catch(e=>{console.error(e.code?`Deployment failed (${e.code}); inspect the checkpoint before retrying.`:e.message);process.exitCode=1;});
