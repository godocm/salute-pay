const assert = require('node:assert/strict');
const Factory = artifacts.require('SaluteTronFactory');
const Receiver = artifacts.require('SaluteTronReceiver');
const Token = artifacts.require('MockTRC20');
const types = {Order:['id:bytes32','merchant:address','token:address','amount:uint256','executorFee:uint256'].map(x=>{const [name,type]=x.split(':');return {name,type};})};
contract('Salute TRON main collection', accounts => {
  let factory,merchant,key,domain,seq=0;
  const zero='0x0000000000000000000000000000000000000000';
  const terms=patch=>({id:'0x'+(++seq).toString(16).padStart(64,'0'),merchant,token:zero,amount:'1000000',executorFee:'100000',...patch});
  const tuple=o=>[o.id,o.merchant,o.token,o.amount,o.executorFee];
  const sign=o=>tronWeb.trx.signTypedData(domain,types,o,key);
  const reject=async f=>{let tx;try{tx=await f();}catch{return;}const h=typeof tx==='string'?tx:tx.tx||tx.transactionHash;const r=await tronWeb.trx.getTransactionInfo(h);assert.ok(r.receipt?.result!=='SUCCESS' && (r.receipt?.result||r.result==='FAILED'));};
  before(async()=>{
    const m=await tronWeb.createAccount();merchant=m.address.base58;key=m.privateKey;factory=await Factory.new();
    const d=await factory.eip712Domain();domain={name:'Salute',version:'4',chainId:String(d.chainId??d[3]),verifyingContract:factory.address};
  });
  it('collects native under/overpayments; per-sweep rewards; late receipts do not require invoice amount',async()=>{
    for(const value of [300000,5000000]){
      const o=terms(),sig=await sign(o),a=await factory.predictAddress(tuple(o));
      await tronWeb.trx.sendTransaction(a,value);const b=await tronWeb.trx.getBalance(merchant);
      await factory.settle(tuple(o),sig);assert.equal((await tronWeb.trx.getBalance(merchant))-b,value-100000);
      const r=await Receiver.at(a);
      await tronWeb.trx.sendTransaction(a,1);const late=await tronWeb.trx.getBalance(merchant);
      await factory.collect(tuple(o),sig,zero,true);assert.equal((await tronWeb.trx.getBalance(merchant))-late,1);
      await reject(()=>r.execute(zero,accounts[0],false));
    }
  });
  it('tiny prefunding can be sponsored without consuming future reward',async()=>{
    const o=terms(),sig=await sign(o),a=await factory.predictAddress(tuple(o));await tronWeb.trx.sendTransaction(a,1);
    await reject(()=>factory.settle(tuple(o),sig));const b=await tronWeb.trx.getBalance(merchant);
    await factory.collect(tuple(o),sig,zero,true);assert.equal((await tronWeb.trx.getBalance(merchant))-b,1);
    const r=await Receiver.at(a);
    await tronWeb.trx.sendTransaction(a,300000);await factory.settle(tuple(o),sig);
  });
  it('wrong tokens go only to merchant and preserve intended native reward',async()=>{
    const t=await Token.new(),o=terms(),sig=await sign(o),a=await factory.predictAddress(tuple(o));
    await t.mint(a,500);const b=BigInt(String(await t.balanceOf(merchant)));
    await factory.collect(tuple(o),sig,t.address,false);assert.equal(BigInt(String(await t.balanceOf(merchant)))-b,500n);
    const r=await Receiver.at(a);
    await tronWeb.trx.sendTransaction(a,300000);await factory.settle(tuple(o),sig);
  });
  it('rejects altered orders and incompatible-domain signatures, keeping prefunded deposits intact',async()=>{
    const o=terms(),sig=await sign(o),a=await factory.predictAddress(tuple(o));await tronWeb.trx.sendTransaction(a,300000);
    assert.equal(await factory.verifyOrder(tuple({...o,amount:'1000001'}),sig),false);
    const old=await tronWeb.trx.signTypedData({...domain,version:'3'},types,o,key);
    await reject(()=>factory.collect(tuple(o),old,zero,true));assert.equal(String(await factory.balanceOf(tuple(o))),'300000');
  });
});
