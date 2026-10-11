import { readFile,writeFile } from 'node:fs/promises';
import { Wallet,ZeroAddress,getAddress,hexlify,randomBytes,verifyTypedData } from 'ethers';
import { domain,portableOrderTypes,authorizationTypes,portableDigest } from './collection.mjs';
async function main(){
  if(!process.env.PRIVATE_KEY || !process.env.ORDER_FILE || !process.env.RECOVERY_CHAIN_ID || !process.env.REWARD_OUTPUT)
    throw Error('Set PRIVATE_KEY, ORDER_FILE, RECOVERY_CHAIN_ID, REWARD_OUTPUT and optionally RECOVERY_ASSET, EXECUTOR_REWARD, MIN_MERCHANT_RECEIPT, REWARD_DEADLINE.');
  const e=JSON.parse(await readFile(process.env.ORDER_FILE,'utf8')),w=new Wallet(process.env.PRIVATE_KEY);
  if(e.version!==4 || getAddress(e.order.merchant)!==w.address
    || verifyTypedData(domain(e.factory,e.order.originChainId),portableOrderTypes,e.order,e.signature)!==w.address)throw Error('This key must authenticate the portable EOA merchant order.');
  const chainId=BigInt(process.env.RECOVERY_CHAIN_ID);
  const authorization={orderDigest:portableDigest(e.factory,e.order),asset:getAddress(process.env.RECOVERY_ASSET||ZeroAddress),reward:String(BigInt(process.env.EXECUTOR_REWARD||'0')),minimumMerchantAmount:String(BigInt(process.env.MIN_MERCHANT_RECEIPT||'1')),nonce:hexlify(randomBytes(32)),deadline:String(BigInt(process.env.REWARD_DEADLINE||Math.floor(Date.now()/1000)+120))};
  if(chainId<=0n || BigInt(authorization.reward)<0n || BigInt(authorization.minimumMerchantAmount)<=0n || BigInt(authorization.deadline)<=BigInt(Math.floor(Date.now()/1000)))throw Error('Invalid reward, minimum receipt, chain or deadline.');
  const signature=await w.signTypedData(domain(e.factory,chainId),authorizationTypes,authorization);
  await writeFile(process.env.REWARD_OUTPUT,JSON.stringify({version:4,chainId:String(chainId),factory:e.factory,authorization,signature},null,2)+'\n',{flag:'wx'});
  console.log('One-use, chain-bound recovery reward authorization saved; no transactions sent.');
}
main().catch(e=>{console.error(e.code?`Reward authorization failed (${e.code}).`:e.message);process.exitCode=1;});
