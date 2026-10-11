import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, Wallet, ZeroAddress, id, keccak256 } from 'ethers';
import { compileContracts } from '../scripts/compile-contracts.mjs';
import { deterministicProxy, deterministicProxyRuntime, deploymentPlan, verifyDeployment,
  expectedFactoryRuntime, domain, portableOrderTypes, authorizationTypes, portableDigest, receiverAddress } from '../scripts/collection.mjs';
const artifacts=compileContracts();
const networks=[];let seq=0;
const deploy=async(n,name,args=[])=>{const a=artifacts[name],c=await new ContractFactory(a.abi,a.bytecode,n.owner).deploy(...args);await c.waitForDeployment();return c;};
const terms=patch=>({id:id(`portable-${++seq}`),merchant:networks[0].merchant.address,token:ZeroAddress,amount:100n,executorFee:2n,originChainId:11155111n,...patch});
const sign=o=>networks[0].merchant.signTypedData(domain(networks[0].factory.target,o.originChainId),portableOrderTypes,o);
const balance=(n,a)=>n.provider.send('eth_getBalance',[a,'latest']).then(BigInt);
const rejects=f=>assert.rejects(async()=>{const tx=await f();if(tx.wait)await tx.wait();});
const fund=async(n,a,value)=>{await(await n.owner.sendTransaction({to:a,value})).wait();};
const collect=async(n,o,s,asset=ZeroAddress,waive=false)=>{
  const r=await(await n.factory.connect(n.executor).collect(o,s,asset,waive)).wait();
  return r.logs.map(l=>{try{return n.factory.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='PaymentCollected').args;
};
before(async()=>{
  // The proxy code injection is a local-only fixture. Factory and receiver deployments use real CREATE2 transactions.
  for(const chainId of [11155111,56,8453,42161]){
    const rpc=ganache.provider({logging:{quiet:true},chain:{chainId,hardfork:'shanghai'},wallet:{deterministic:true,defaultBalance:1000}});
    const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1,pollingInterval:10});
    const [owner,executor]=await Promise.all([provider.getSigner(chainId===11155111?0:3),provider.getSigner(2)]);
    const signer=await provider.getSigner(1),merchant=new Wallet(rpc.getInitialAccounts()[signer.address.toLowerCase()].secretKey);
    await provider.send('evm_setAccountCode',[deterministicProxy,deterministicProxyRuntime]);
    const plan=await verifyDeployment(provider,artifacts.PaymentFactory);
    // Different transaction senders/nonces on other chains cannot change canonical factory identity.
    await(await owner.sendTransaction({to:deterministicProxy,data:plan.data})).wait();
    assert.equal((await verifyDeployment(provider,artifacts.PaymentFactory)).deployed,true);
    const factory=new Contract(plan.factory,artifacts.PaymentFactory.abi,owner);
    networks.push({rpc,provider,owner,executor,merchant,factory,chainId});
  }
});
after(async()=>{for(const n of networks){n.provider.destroy();await n.rpc.disconnect();}});
test('canonical factories, implementation code, portable digests and receiver addresses match across four different chain IDs',async()=>{
  const [a,...rest]=networks,o=terms(),s=await sign(o),address=await a.factory.predictAddress(o);
  for(const n of networks){
    assert.equal(n.factory.target,a.factory.target);assert.equal(await n.factory.implementation(),await a.factory.implementation());
    assert.equal(await n.factory.predictAddress(o),address);assert.equal(await n.factory.orderDigest(o),portableDigest(a.factory.target,o));
    assert.equal(await n.factory.verifyOrder(o,s),true);
    assert.equal(receiverAddress(n.factory.target,await n.factory.implementation(),o),address);
    assert.equal(keccak256(await n.provider.getCode(n.factory.target)),keccak256(expectedFactoryRuntime(artifacts.PaymentFactory)));
  }
  const different=await deploy(rest[0],'PaymentFactory');
  assert.notEqual(await different.predictAddress(o),address);assert.equal(await different.verifyOrder(o,s),false);
});
test('deposit on a fifth network BEFORE factory or receiver deployment is recoverable after deterministic factory deployment',async()=>{
  const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:137,hardfork:'shanghai'},wallet:{deterministic:true,defaultBalance:1000}});
  const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1,pollingInterval:10});
  try{
    const owner=await provider.getSigner(4),executor=await provider.getSigner(2),o=terms(),s=await sign(o);
    const a=await networks[0].factory.predictAddress(o),plan=deploymentPlan(artifacts.PaymentFactory);
    assert.equal(await provider.getCode(plan.factory),'0x');assert.equal(await provider.getCode(a),'0x');
    await(await owner.sendTransaction({to:a,value:500n})).wait();
    await provider.send('evm_setAccountCode',[deterministicProxy,deterministicProxyRuntime]);
    await(await owner.sendTransaction({to:deterministicProxy,data:plan.data})).wait();
    const factory=new Contract(plan.factory,artifacts.PaymentFactory.abi,owner);
    const before=await balance({provider},o.merchant);await collect({factory,executor},o,s);
    assert.equal((await balance({provider},o.merchant))-before,500n);assert.equal(await balance({provider},a),0n);
  }finally{provider.destroy();await rpc.disconnect();}
});
test('an Ethereum order recovers arbitrary native balances on BSC/Base/Arbitrum to only its merchant, without invoice minimum',async()=>{
  for(const [i,n] of networks.slice(1).entries()){
    const o=terms(),s=await sign(o),address=await networks[0].factory.predictAddress(o),amount=[1n,10n,500n][i];
    await fund(n,address,amount);assert.equal(await n.provider.getCode(address),'0x');
    const before=await balance(n,o.merchant),e=await collect(n,o,s);
    assert.equal((await balance(n,o.merchant))-before,amount);assert.equal(e.received,amount);assert.equal(e.executorReward,0n);
    assert.equal(e.originChainId,11155111n);assert.equal(e.executionChainId,BigInt(n.chainId));
    await fund(n,address,1n);await collect(n,o,s);assert.equal(await balance(n,address),0n);
    await rejects(()=>n.factory.settle(o,s));
  }
});
test('wrong-network tokens with different addresses/decimals recover using unchanged original order and signature',async()=>{
  const [a,b]=networks,original=await deploy(a,'MockERC20',['Original USDT','USDT',6]),actual=await deploy(b,'MockERC20',['BSC asset','B',18]);
  assert.notEqual(original.target,actual.target);
  const o=terms({token:original.target}),s=await sign(o),address=await a.factory.predictAddress(o);
  await(await actual.mint(address,500n)).wait();const before=await actual.balanceOf(o.merchant);
  const e=await collect(b,o,s,actual.target);assert.equal((await actual.balanceOf(o.merchant))-before,500n);assert.equal(e.asset,actual.target);assert.equal(e.executorReward,0n);
  await(await original.mint(address,10n)).wait();const originalReceipt=await collect(a,o,s,original.target);assert.equal(originalReceipt.executorReward,2n);
});
test('origin-chain rewards are per sweep, sponsorship skips executor payout, and tiny balances remain recoverable',async()=>{
  const n=networks[0],o=terms(),s=await sign(o),a=await n.factory.predictAddress(o);
  for(const value of [10n,90n]){await fund(n,a,value);const e=await collect(n,o,s);assert.equal(e.executorReward,2n);assert.equal(e.merchantAmount,value-2n);}
  await fund(n,a,1n);await rejects(()=>n.factory.collect(o,s,ZeroAddress,false));
  const e=await collect(n,o,s,ZeroAddress,true);assert.equal(e.merchantAmount,1n);assert.equal(e.executorReward,0n);
  await rejects(()=>n.factory.collect(o,s,ZeroAddress,true));
});
test('foreign-asset reward quotes bind actual chain, factory, order, asset, nonce, deadline and merchant receipt',async()=>{
  const n=networks[1],o=terms(),s=await sign(o),a=await n.factory.predictAddress(o),token=await deploy(n,'MockERC20',['Quote Asset','Q',6]);
  await(await token.mint(a,10n)).wait();
  const auth={orderDigest:await n.factory.orderDigest(o),asset:token.target,reward:2n,minimumMerchantAmount:8n,nonce:id(`quote-${seq}`),deadline:BigInt((await n.provider.getBlock('latest')).timestamp+600)};
  const qs=await networks[0].merchant.signTypedData(domain(n.factory.target,n.chainId),authorizationTypes,auth);
  for(const patch of [{reward:3n},{asset:ZeroAddress},{minimumMerchantAmount:9n},{orderDigest:id('other')},{nonce:id('other nonce')}]){
    await rejects(()=>n.factory.collectWithReward(o,s,{...auth,...patch},qs));
  }
  const wrongChain=await networks[0].merchant.signTypedData(domain(n.factory.target,11155111),authorizationTypes,auth);
  await rejects(()=>n.factory.collectWithReward(o,s,auth,wrongChain));
  await(await n.factory.connect(n.executor).collectWithReward(o,s,auth,qs)).wait();
  assert.equal(await token.balanceOf(o.merchant),8n);assert.equal(await token.balanceOf(n.executor.address),2n);
  await(await token.mint(a,10n)).wait();await rejects(()=>n.factory.collectWithReward(o,s,auth,qs));
  assert.equal(await token.balanceOf(a),10n);assert.equal(await n.factory.usedAuthorizations(o.merchant,auth.nonce),true);
  const expired={...auth,nonce:id('expired'),deadline:1n};const es=await networks[0].merchant.signTypedData(domain(n.factory.target,n.chainId),authorizationTypes,expired);
  await rejects(()=>n.factory.collectWithReward(o,s,expired,es));
});
test('failed collection rolls deployment and reward authorization consumption back; direct execution and callbacks cannot steal',async()=>{
  const n=networks[1],bad=await deploy(n,'FalseReturnToken'),o=terms(),s=await sign(o),a=await n.factory.predictAddress(o);
  await(await bad.mint(a,10n)).wait();
  const q={orderDigest:await n.factory.orderDigest(o),asset:bad.target,reward:2n,minimumMerchantAmount:1n,nonce:id(`rollback-${seq}`),deadline:2n**64n};
  const qs=await networks[0].merchant.signTypedData(domain(n.factory.target,n.chainId),authorizationTypes,q);
  await rejects(()=>n.factory.collectWithReward(o,s,q,qs,{gasLimit:3000000}));assert.equal(await n.provider.getCode(a),'0x');assert.equal(await bad.balanceOf(a),10n);assert.equal(await n.factory.usedAuthorizations(o.merchant,q.nonce),false);
  const attack=await deploy(n,'AdversarialToken'),v=terms(),vs=await sign(v),va=await n.factory.predictAddress(v);
  await(await attack.mint(va,10n)).wait();await(await attack.configure(n.factory.target,n.factory.interface.encodeFunctionData('collect',[v,vs,attack.target,true]),false)).wait();
  await collect(n,v,vs,attack.target);assert.equal(await attack.attempted(),true);assert.equal(await attack.reentrySucceeded(),false);
  const receiver=new Contract(va,artifacts.PaymentReceiver.abi,n.executor);
  await rejects(()=>receiver.execute(attack.target,n.executor.address,10n,1n));
});
test('smart-wallet validation works on origin only; foreign contract state cannot authenticate an origin wallet',async()=>{
  const [a,b]=networks,w=await deploy(a,'Mock1271Merchant',[a.merchant.address]),o=terms({merchant:w.target}),s=await sign(o);
  assert.equal(await a.factory.verifyOrder(o,s),true);assert.equal(await b.factory.verifyOrder(o,s),false);
  const address=await a.factory.predictAddress(o);await fund(b,address,10n);await rejects(()=>b.factory.collect(o,s,ZeroAddress,true));assert.equal(await balance(b,address),10n);
  await fund(a,address,10n);await collect(a,o,s);assert.equal(await balance(a,w.target),8n);
});
test('deployment planner rejects absent/wrong bootstrap and occupied factory code',async()=>{
  const n=networks[3],factoryCode=await n.provider.getCode(n.factory.target);
  await n.provider.send('evm_setAccountCode',[n.factory.target,'0x00']);await assert.rejects(()=>verifyDeployment(n.provider,artifacts.PaymentFactory));
  await n.provider.send('evm_setAccountCode',[n.factory.target,factoryCode]);
  await n.provider.send('evm_setAccountCode',[deterministicProxy,'0x']);await assert.rejects(()=>verifyDeployment(n.provider,artifacts.PaymentFactory));
  await n.provider.send('evm_setAccountCode',[deterministicProxy,deterministicProxyRuntime]);assert.equal((await verifyDeployment(n.provider,artifacts.PaymentFactory)).deployed,true);
  assert.equal(deploymentPlan(artifacts.PaymentFactory).factory,n.factory.target);
});
test('zero-reward token sweep emits one payout, rewarded sweep emits two; repeated sweeps avoid deployment gas',async()=>{
 const n=networks[0],token=await deploy(n,'MockERC20',['Payment Token','PAY',6]);
 const zero=terms({token:token.target,executorFee:0n}),zs=await sign(zero),za=await n.factory.predictAddress(zero);
 await(await token.mint(za,100)).wait();const first=await(await n.factory.connect(n.executor).settle(zero,zs)).wait();
 const transferLogs=r=>r.logs.filter(l=>l.address.toLowerCase()===String(token.target).toLowerCase()&&token.interface.parseLog(l)?.name==='Transfer');
 assert.equal(transferLogs(first).length,1);assert.equal(await token.balanceOf(n.executor.address),0n);
 await(await token.mint(za,100)).wait();const late=await(await n.factory.connect(n.executor).settle(zero,zs)).wait();assert.equal(transferLogs(late).length,1);assert.ok(late.gasUsed<first.gasUsed);
 const rewarded=terms({token:token.target}),rs=await sign(rewarded),ra=await n.factory.predictAddress(rewarded);await(await token.mint(ra,100)).wait();
 const withReward=await(await n.factory.connect(n.executor).settle(rewarded,rs)).wait();assert.equal(transferLogs(withReward).length,2);assert.ok(withReward.gasUsed>first.gasUsed);
 const fn=artifacts.PaymentFactory.abi.filter(x=>x.type==='function').map(x=>x.name);assert.ok(!fn.some(x=>/owner|upgrade|admin|setMerchant/i.test(x)));
 console.log(JSON.stringify({measurement:'local Ganache ERC20 gas, not public network pricing',firstSponsored:String(first.gasUsed),repeatSponsored:String(late.gasUsed),firstRewarded:String(withReward.gasUsed)}));
});
