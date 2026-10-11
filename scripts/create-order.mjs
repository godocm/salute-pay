import { readFile,writeFile } from 'node:fs/promises';
import { Wallet,ZeroAddress,getAddress,hexlify,randomBytes } from 'ethers';
import { deploymentPlan,receiverAddress,domain,portableOrderTypes } from './collection.mjs';
async function main(){
  if(!process.env.PRIVATE_KEY || !process.env.ORIGIN_CHAIN_ID || !process.env.ORDER_AMOUNT || !process.env.ORDER_OUTPUT)
    throw Error('Set PRIVATE_KEY, ORIGIN_CHAIN_ID, ORDER_AMOUNT, ORDER_OUTPUT; optionally ORDER_TOKEN and EXECUTOR_FEE.');
  const merchant=new Wallet(process.env.PRIVATE_KEY);
  const order={id:hexlify(randomBytes(32)),merchant:merchant.address,token:getAddress(process.env.ORDER_TOKEN||ZeroAddress),amount:String(BigInt(process.env.ORDER_AMOUNT)),executorFee:String(BigInt(process.env.EXECUTOR_FEE||'0')),originChainId:String(BigInt(process.env.ORIGIN_CHAIN_ID))};
  if(BigInt(order.amount)<=0n || BigInt(order.executorFee)<0n || BigInt(order.executorFee)>=BigInt(order.amount) || BigInt(order.originChainId)<=0n)throw Error('Invalid order amount, reward or origin chain. Values use asset base units.');
  const artifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url))),plan=deploymentPlan(artifact);
  const envelope={version:4,factory:plan.factory,initCodeHash:plan.initCodeHash,order,signature:await merchant.signTypedData(domain(plan.factory,order.originChainId),portableOrderTypes,order),deposit:receiverAddress(plan.factory,plan.implementation,order)};
  await writeFile(process.env.ORDER_OUTPUT,JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
  console.log(`Signed portable order saved. Deposit: ${envelope.deposit}. Verify canonical main deployments before sharing checkout.`);
}
main().catch(e=>{console.error(e.code?`Order creation failed (${e.code}).`:e.message);process.exitCode=1;});
