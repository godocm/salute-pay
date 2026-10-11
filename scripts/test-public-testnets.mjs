import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,NonceManager,Contract,FetchRequest,id,ZeroAddress,randomBytes,hexlify} from 'ethers';
import {loadEnvironment,catalog} from './testnet-config.mjs';
import {verifyDeployment,domain,portableOrderTypes,authorizationTypes,portableDigest} from './collection.mjs';
if(!process.argv.includes('--broadcast'))throw Error('Public smoke tests send testnet transactions; explicit --broadcast required');
const env=await loadEnvironment(),registry=JSON.parse(await readFile(new URL('../portal/public/deployments/main.json',import.meta.url))),artifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url))),report={at:new Date().toISOString(),networks:{},crossChain:null};
await mkdir(new URL('../.data/testnets/',import.meta.url),{recursive:true});
const chosenAt=process.argv.indexOf('--networks'),chosen=chosenAt>=0?process.argv[chosenAt+1].split(','):null;
if(chosen){try{const old=JSON.parse(await readFile(new URL('../deployments/testnet-validation.json',import.meta.url)));report.networks=old.networks;report.crossChain=old.crossChain;}catch{}}
const nodes={};
const wait=async(p,hash)=>{const deadline=Date.now()+180000;while(Date.now()<deadline){const r=await p.getTransactionReceipt(hash);if(r){assert.equal(r.status,1);if(await p.getBlockNumber()>=r.blockNumber+1){await new Promise(resolve=>setTimeout(resolve,1500));return r;}}await new Promise(r=>setTimeout(r,1500));}throw Error('Confirmation timeout; inspect transaction before retrying')};
const send=async(n,method,args)=>{let gas,last;for(let attempt=0;attempt<8;attempt++){try{gas=await method.estimateGas(...args);break;}catch(e){last=e;await new Promise(r=>setTimeout(r,1500));}}if(gas===undefined)throw last;const tx=await method(...args,{gasLimit:gas*120n/100n});const receipt=await wait(n.p,tx.hash);n.transactions.push({hash:tx.hash,gasUsed:String(receipt.gasUsed)});return receipt;};
try{
 for(const [chain,r] of Object.entries(registry.networks).filter(([c])=>catalog[c]&&(!chosen||chosen.includes(c)))){
  let n;try{
   const req=new FetchRequest(env[chain.toUpperCase()+'_RPC_URL']||catalog[chain].rpc);req.timeout=25000;const p=new JsonRpcProvider(req,undefined,{cacheTimeout:-1,pollingInterval:1500});
   const wallet=new Wallet(env[chain.toUpperCase()+'_DEPLOYER_PRIVATE_KEY']||env.EVM_DEPLOYER_PRIVATE_KEY,p),signer=new NonceManager(wallet),merchant=Wallet.createRandom();
   n={p,wallet,signer,merchant,transactions:[],config:r};nodes[chain]=n;
   assert.equal(String((await p.getNetwork()).chainId),r.chainId);assert.equal((await verifyDeployment(p,artifact)).deployed,true);
   const f=new Contract(r.deployment,artifact.abi,signer),token=new Contract(r.token,['function balanceOf(address) view returns(uint256)','function mint(address,uint256)','function transfer(address,uint256) returns(bool)'],signer);n.f=f;n.token=token;
   if(chain==='tempo')await send(n,new Contract('0xfeec000000000000000000000000000000000000',['function setUserToken(address)'],signer).setUserToken,[r.feeToken]);
   const order={id:hexlify(randomBytes(32)),merchant:merchant.address,token:r.token,amount:'100000000',executorFee:'2000000',originChainId:r.chainId},signature=await merchant.signTypedData(domain(r.deployment,r.chainId),portableOrderTypes,order),address=await f.predictAddress(order);
   const testFile=new URL(`../.data/testnets/${chain}-${order.id.slice(2)}.json`,import.meta.url);await writeFile(testFile,JSON.stringify({chain,order,signature,address},null,2));
   await assert.rejects(()=>f.settle.staticCall({...order,amount:'101000000'},signature));
   const faucet=chain==='tempo'?new Contract(r.faucet,['function mint(address,uint256)'],signer):token;
   await send(n,faucet.mint,[wallet.address,'1000000000']); // Same public faucet call as the UI; no issuer key required.
   assert.equal(await p.getCode(address),'0x');
   await send(n,token.transfer,[address,'10000000']);
   let before=await token.balanceOf(merchant.address),receipt=await send(n,f.settle,[order,signature]);assert.equal(await token.balanceOf(merchant.address)-before,8000000n);
   let event=receipt.logs.map(l=>{try{return f.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='PaymentCollected');assert.equal(event.args.executorReward,2000000n);
   await send(n,token.transfer,[address,'500000000']);before=await token.balanceOf(merchant.address);await send(n,f.settle,[order,signature]);assert.equal(await token.balanceOf(merchant.address)-before,498000000n);
   await send(n,token.transfer,[address,'1000000']);before=await token.balanceOf(merchant.address);receipt=await send(n,f.collect,[order,signature,r.token,true]);assert.equal(await token.balanceOf(merchant.address)-before,1000000n);
   event=receipt.logs.map(l=>{try{return f.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='PaymentCollected');assert.equal(event.args.executorReward,0n);
   const zero={...order,id:hexlify(randomBytes(32)),executorFee:'0'},zs=await merchant.signTypedData(domain(r.deployment,r.chainId),portableOrderTypes,zero),za=await f.predictAddress(zero);await send(n,token.transfer,[za,'10000000']);before=await token.balanceOf(merchant.address);receipt=await send(n,f.settle,[zero,zs]);assert.equal(await token.balanceOf(merchant.address)-before,10000000n);
   assert.equal(receipt.logs.filter(l=>l.address.toLowerCase()===r.token.toLowerCase()&&l.topics[0]===id('Transfer(address,address,uint256)')).length,1);
   report.networks[chain]={status:'passed',merchant:merchant.address,orderAddress:address,checks:['EIP-712 binding','public faucet','funding before receiver deployment','10 underpayment -> 8 merchant + 2 reward','500 overpayment -> 498 merchant + 2 reward','late tiny deposit with waived reward','zero reward -> one payout transfer'],transactions:n.transactions};console.log(`${chain}: public under/over/late/zero-reward tests passed`);
  }catch(e){report.networks[chain]={status:'failed',reason:e.shortMessage||e.code||e.message,transactions:n?.transactions};process.exitCode=1;console.log(`${chain}: test failed; inspect recorded transaction receipts`);}
  await writeFile(new URL('../deployments/testnet-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 }
 if(nodes.ethereum&&!nodes.arbitrum&&registry.networks.arbitrum&&report.networks.arbitrum?.status==='passed'){
 const r=registry.networks.arbitrum,req=new FetchRequest(env.ARBITRUM_RPC_URL||catalog.arbitrum.rpc);req.timeout=25000;const p=new JsonRpcProvider(req,undefined,{cacheTimeout:-1,pollingInterval:1500}),wallet=new Wallet(env.ARBITRUM_DEPLOYER_PRIVATE_KEY||env.EVM_DEPLOYER_PRIVATE_KEY,p),signer=new NonceManager(wallet);nodes.arbitrum={p,wallet,signer,transactions:[],config:r,f:new Contract(r.deployment,artifact.abi,signer),token:new Contract(r.token,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)'],signer)};
 }
 if(nodes.ethereum&&nodes.arbitrum&&report.networks.ethereum.status==='passed'&&report.networks.arbitrum.status==='passed'){
  const origin=nodes.ethereum,target=nodes.arbitrum,m=origin.merchant,order={id:hexlify(randomBytes(32)),merchant:m.address,token:origin.config.token,amount:'100000000',executorFee:'2000000',originChainId:origin.config.chainId},signature=await m.signTypedData(domain(origin.config.deployment,order.originChainId),portableOrderTypes,order),address=await origin.f.predictAddress(order);
  assert.equal(await target.f.predictAddress(order),address);await send(target,target.token.transfer,[address,'25000000']);let before=await target.token.balanceOf(m.address),receipt=await send(target,target.f.collect,[order,signature,target.config.token,false]);assert.equal(await target.token.balanceOf(m.address)-before,25000000n);
  let event=receipt.logs.map(l=>{try{return target.f.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='PaymentCollected');assert.equal(event.args.executorReward,0n);
  await send(target,target.token.transfer,[address,'10000000']);const auth={orderDigest:portableDigest(target.config.deployment,order),asset:target.config.token,reward:'2000000',minimumMerchantAmount:'1000000',nonce:hexlify(randomBytes(32)),deadline:Math.floor(Date.now()/1000)+3600},rs=await m.signTypedData(domain(target.config.deployment,target.config.chainId),authorizationTypes,auth);before=await target.token.balanceOf(m.address);await send(target,target.f.collectWithReward,[order,signature,auth,rs]);assert.equal(await target.token.balanceOf(m.address)-before,8000000n);assert.equal(await target.f.usedAuthorizations(m.address,auth.nonce),true);await assert.rejects(()=>target.f.collectWithReward.staticCall(order,signature,auth,rs));
  report.crossChain={status:'passed',origin:'ethereum',execution:'arbitrum',sameAddress:address,checks:['unchanged origin-signed intent','same receiver address across chains','actual-asset recovery to immutable merchant','foreign default zero reward','execution-chain reward quote','quote nonce replay rejected'],transactionHashes:target.transactions.slice(-4).map(t=>t.hash)};console.log('Ethereum -> Arbitrum: live cross-chain recovery and reward quote passed');
 }
}catch(e){report.error=e.shortMessage||e.code||e.message;process.exitCode=1;}finally{await writeFile(new URL('../deployments/testnet-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');for(const n of Object.values(nodes))n.p.destroy();}
