import { readFile } from 'node:fs/promises';
import { Contract,JsonRpcProvider,Wallet,ZeroAddress,getAddress } from 'ethers';
import { verifyDeployment,receiverAddress } from './collection.mjs';
async function main(){
  const broadcast=process.argv.includes('--broadcast');
  if(!process.env.RPC_URL || !process.env.EXPECTED_CHAIN_ID || !process.env.ORDER_FILE)
    throw Error('Set RPC_URL, EXPECTED_CHAIN_ID, ORDER_FILE and RECOVERY_ASSET (or use native).');
  if(!broadcast && !process.env.EXECUTOR_ADDRESS)throw Error('Dry run requires EXECUTOR_ADDRESS for accurate reward simulation.');
  if(broadcast && !process.env.PRIVATE_KEY)throw Error('Broadcast requires PRIVATE_KEY of the funded executor.');
  const p=new JsonRpcProvider(process.env.RPC_URL,undefined,{cacheTimeout:-1});
  try{
    const chainId=String((await p.getNetwork()).chainId);if(chainId!==process.env.EXPECTED_CHAIN_ID)throw Error('RPC chain mismatch.');
    const a=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url)));
    const plan=await verifyDeployment(p,a);if(!plan.deployed)throw Error('Deploy the canonical main factory on this chain first.');
    const envelope=JSON.parse(await readFile(process.env.ORDER_FILE,'utf8'));
    if(envelope.version!==4 || getAddress(envelope.factory)!==plan.factory || envelope.initCodeHash!==plan.initCodeHash
      || getAddress(envelope.deposit)!==receiverAddress(plan.factory,plan.implementation,envelope.order))throw Error('Order does not match this pinned canonical main deployment.');
    const asset=!process.env.RECOVERY_ASSET || process.env.RECOVERY_ASSET==='native'?ZeroAddress:getAddress(process.env.RECOVERY_ASSET);
    const signer=broadcast?new Wallet(process.env.PRIVATE_KEY,p):undefined;
    const executor=signer?.address || getAddress(process.env.EXECUTOR_ADDRESS);
    const f=new Contract(plan.factory,a.abi,signer||p);
    if(!await f.verifyOrder(envelope.order,envelope.signature))throw Error('Invalid portable merchant authorization. Foreign ERC-1271 wallets are unsupported.');
    const balance=await f.balanceOfAsset(envelope.order,asset);
    let method,args;
    if(process.env.REWARD_FILE){
      const q=JSON.parse(await readFile(process.env.REWARD_FILE,'utf8'));
      if(getAddress(q.authorization.asset)!==asset)throw Error('Reward authorization asset mismatch.');
      method=f.collectWithReward;args=[envelope.order,envelope.signature,q.authorization,q.signature];
    }else{
      method=f.collect;args=[envelope.order,envelope.signature,asset,process.env.WAIVE_REWARD==='true'];
    }
    await method.staticCall(...args,{from:executor});
    console.log(JSON.stringify({chainId,deposit:envelope.deposit,merchant:envelope.order.merchant,asset,balance:String(balance),executor,broadcast},null,2));
    if(!broadcast){console.log('Simulation passed; no transactions sent. Add --broadcast to collect.');return;}
    const tx=await method(...args);await tx.wait();console.log(`Collected on execution chain ${chainId}: ${tx.hash}`);
  }finally{p.destroy();}
}
main().catch(e=>{console.error(e.code?`Recovery failed (${e.code}); no keys or private RPC URLs are logged.`:e.message);process.exitCode=1;});
