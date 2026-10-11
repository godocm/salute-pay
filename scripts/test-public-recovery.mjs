import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {JsonRpcProvider, Wallet, NonceManager, Contract, FetchRequest, id, ZeroAddress, hexlify, randomBytes} from 'ethers';
import {loadEnvironment, catalog} from './testnet-config.mjs';
import {verifyDeployment, domain, portableOrderTypes, authorizationTypes, portableDigest} from './collection.mjs';
if (!process.argv.includes('--broadcast')) throw Error('Public recovery tests require explicit --broadcast.');
const env=await loadEnvironment(),registry=JSON.parse(await readFile(new URL('../portal/public/deployments/main.json',import.meta.url))),artifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url)));
const index=process.argv.indexOf('--networks'),selected=(index>=0?process.argv[index+1]:'base,bnb').split(',');
if(selected.some(chain=>!catalog[chain]||!registry.networks[chain]))throw Error('Select activated EVM testnets.');
const report={at:new Date().toISOString(),origin:'ethereum',networks:{}},path=new URL('../deployments/recovery-validation.json',import.meta.url);
try{report.networks=JSON.parse(await readFile(path)).networks||{};}catch(e){if(e.code!=='ENOENT')throw e;}
const provider=chain=>{const request=new FetchRequest(env[chain.toUpperCase()+'_RPC_URL']||catalog[chain].rpc);request.timeout=25000;return new JsonRpcProvider(request,undefined,{cacheTimeout:-1,pollingInterval:1500});};
const origin=registry.networks.ethereum,op=provider('ethereum'),merchant=Wallet.createRandom();
await mkdir(new URL('../.data/testnets/',import.meta.url),{recursive:true});
const order={id:hexlify(randomBytes(32)),merchant:merchant.address,token:origin.token,amount:'100000000',executorFee:'2000000',originChainId:origin.chainId};
const signature=await merchant.signTypedData(domain(origin.deployment,origin.chainId),portableOrderTypes,order);
let address;
try {assert.equal(String((await op.getNetwork()).chainId),origin.chainId);assert.equal((await verifyDeployment(op,artifact)).deployed,true);address=await new Contract(origin.deployment,artifact.abi,op).predictAddress(order);}finally{op.destroy();}
await writeFile(new URL(`../.data/testnets/portable-${order.id.slice(2)}.json`,import.meta.url),JSON.stringify({order,signature,address},null,2));
const pause=()=>new Promise(resolve=>setTimeout(resolve,1500));
for(const chain of selected){
 const p=provider(chain),r=registry.networks[chain],wallet=new Wallet(env[chain.toUpperCase()+'_DEPLOYER_PRIVATE_KEY']||env.EVM_DEPLOYER_PRIVATE_KEY,p),signer=new NonceManager(wallet),transactions=[];
 const send=async (method,args)=>{let gas,error;for(let i=0;i<8;i++){try{gas=await method.estimateGas(...args);break;}catch(e){error=e;await pause();}}if(!gas)throw error;const tx=await method(...args,{gasLimit:gas*120n/100n});return confirmed(tx);};
 const confirmed=async tx=>{const until=Date.now()+180000;let receipt;while(Date.now()<until){receipt=await p.getTransactionReceipt(tx.hash);if(receipt&&await p.getBlockNumber()>receipt.blockNumber)break;await pause();}assert.ok(receipt);assert.equal(receipt.status,1);await pause();transactions.push({hash:tx.hash,gasUsed:String(receipt.gasUsed)});return receipt;};
 const collected=receipt=>receipt.logs.map(log=>{try{return f.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='PaymentCollected');
 const f=new Contract(r.deployment,artifact.abi,signer),token=new Contract(r.token,['function balanceOf(address) view returns(uint256)','function mint(address,uint256)','function transfer(address,uint256) returns(bool)'],signer);
 try {
  assert.equal(String((await p.getNetwork()).chainId),r.chainId);assert.equal((await verifyDeployment(p,artifact)).deployed,true);assert.equal(r.deployment,origin.deployment);assert.equal(await f.predictAddress(order),address);
  if(await token.balanceOf(wallet.address)<35000000n)await send(token.mint,[wallet.address,1000000000n]);
  await send(token.transfer,[address,25000000n]);let before=await token.balanceOf(merchant.address),receipt=await send(f.collect,[order,signature,r.token,false]);assert.equal(await token.balanceOf(merchant.address)-before,25000000n);assert.equal(collected(receipt).args.executorReward,0n);
  await send(token.transfer,[address,10000000n]);const quote={orderDigest:portableDigest(r.deployment,order),asset:r.token,reward:'2000000',minimumMerchantAmount:'1000000',nonce:hexlify(randomBytes(32)),deadline:Math.floor(Date.now()/1000)+3600},quoteSignature=await merchant.signTypedData(domain(r.deployment,r.chainId),authorizationTypes,quote);
  before=await token.balanceOf(merchant.address);await send(f.collectWithReward,[order,signature,quote,quoteSignature]);assert.equal(await token.balanceOf(merchant.address)-before,8000000n);assert.equal(await f.usedAuthorizations(merchant.address,quote.nonce),true);await assert.rejects(()=>f.collectWithReward.staticCall(order,signature,quote,quoteSignature));
  await confirmed(await signer.sendTransaction({to:address,value:25000n}));before=await p.getBalance(merchant.address);receipt=await send(f.collect,[order,signature,ZeroAddress,false]);assert.equal(await p.getBalance(merchant.address)-before,25000n);assert.equal(collected(receipt).args.executorReward,0n);
  const native={...order,id:hexlify(randomBytes(32)),token:ZeroAddress,amount:'10000000',executorFee:'1000000',originChainId:r.chainId},ns=await merchant.signTypedData(domain(r.deployment,r.chainId),portableOrderTypes,native),na=await f.predictAddress(native);
  assert.equal(await p.getCode(na),'0x');
  for(const deposit of [3000000n,50000000n]){await confirmed(await signer.sendTransaction({to:na,value:deposit}));before=await p.getBalance(merchant.address);receipt=await send(f.settle,[native,ns]);assert.equal(await p.getBalance(merchant.address)-before,deposit-1000000n);assert.equal(collected(receipt).args.executorReward,1000000n);}
  report.networks[chain]={status:'passed',sameAddress:address,checks:['unchanged Ethereum-origin signed intent','canonical receiver address equality','foreign-chain token recovery with zero default reward','execution-chain reward quote and nonce replay rejection','wrong native asset recovery to immutable merchant','native underpayment and overpayment with per-sweep rewards'],transactions};
  console.log(`${chain}: live cross-chain token/native recovery, reward quotes and native under/overpayment passed`);
 }catch(e){report.networks[chain]={status:'failed',reason:e.shortMessage||e.code||e.message,transactions};process.exitCode=1;console.log(`${chain}: recovery validation failed; recorded receipts preserved`);}
 finally {p.destroy();await writeFile(path,JSON.stringify(report,null,2)+'\n');}
}
