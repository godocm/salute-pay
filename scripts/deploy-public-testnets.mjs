import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,NonceManager,Contract,ContractFactory,FetchRequest,id,keccak256,getCreateAddress,ZeroAddress} from 'ethers';
import {catalog,loadEnvironment} from './testnet-config.mjs';
import {verifyDeployment,deterministicProxy} from './collection.mjs';
const env=await loadEnvironment(),broadcast=process.argv.includes('--broadcast');
const selectionAt=process.argv.indexOf('--networks'),selected=selectionAt>=0?process.argv[selectionAt+1]?.split(','):Object.keys(catalog);
if(!selected?.length||new Set(selected).size!==selected.length||selected.some(chain=>!catalog[chain]))throw Error('Select supported unique EVM networks.');
const wait=async(p,hash)=>{const deadline=Date.now()+180000;while(Date.now()<deadline){const raw=await p.send('eth_getTransactionReceipt',[hash]);if(raw){if(BigInt(raw.status)!==1n)throw Error('Public testnet transaction reverted');return raw;}await new Promise(r=>setTimeout(r,1500));}throw Error('Transaction remains pending; inspect checkpoint before retrying');};
const artifacts=Object.fromEntries(await Promise.all(['PaymentFactory','TestUSD','TempoTestUSD'].map(async n=>[n,JSON.parse(await readFile(new URL(`../artifacts/${n}.json`,import.meta.url)))])));
const registryPath=new URL('../portal/public/deployments/main.json',import.meta.url),registry=JSON.parse(await readFile(registryPath)),report={at:new Date().toISOString(),networks:{}};
try{report.networks=JSON.parse(await readFile(new URL('../deployments/main-testnets.json',import.meta.url))).networks||{};}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(new URL('../.data/deployments/',import.meta.url),{recursive:true});
for(const [chain,config] of Object.entries(catalog).filter(([chain])=>selected.includes(chain))){
 const url=new URL(`../.data/deployments/${chain}-public-main.json`,import.meta.url);let p;
 const save=async r=>writeFile(url,JSON.stringify(r,null,2)+'\n');
 try{
  const rpc=env[chain.toUpperCase()+'_RPC_URL']||config.rpc,request=new FetchRequest(rpc);request.timeout=25000;if(new URL(rpc).protocol!=='https:')throw Error('HTTPS testnet RPC required');
  p=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,pollingInterval:1500});if(String((await p.getNetwork()).chainId)!==config.chainId)throw Error('RPC chain mismatch');
  const key=env[chain.toUpperCase()+'_DEPLOYER_PRIVATE_KEY']||env.EVM_DEPLOYER_PRIVATE_KEY;if(!key)throw Error('Deployer key missing');
  const wallet=new Wallet(key,p),signer=new NonceManager(wallet),feeToken=chain==='tempo'?(env.TEMPO_FEE_TOKEN||config.feeToken):undefined;
  const balance=chain==='tempo'?await new Contract(feeToken,['function balanceOf(address) view returns(uint256)'],p).balanceOf(wallet.address):await p.getBalance(wallet.address);
  const plan=await verifyDeployment(p,artifacts.PaymentFactory);if(!plan.deployed&&balance===0n){report.networks[chain]={status:'skipped',reason:'No testnet gas balance',address:wallet.address};continue;}
  let record;try{record=JSON.parse(await readFile(url));}catch(e){if(e.code!=='ENOENT')throw e;}
  record ||= {chain,chainId:config.chainId,factory:plan.factory,deployment:plan.factory,implementation:plan.implementation,deployer:wallet.address,domain:'',feeToken,phase:'prepared',createdAt:new Date().toISOString()};
  if(record.factory!==plan.factory)throw Error('Checkpoint belongs to different bytecode');
  if(!broadcast){console.log(`${chain}: ${balance>0n?'funded':'unfunded'}; canonical factory ${plan.factory}`);continue;}
  if(chain==='tempo'){
   const manager=new Contract('0xfeec000000000000000000000000000000000000',['function userTokens(address) view returns(address)','function setUserToken(address)'],signer);
   let current;try{current=await manager.userTokens(wallet.address);}catch{current=ZeroAddress;}
   if(current.toLowerCase()!==feeToken.toLowerCase()){const tx=await manager.setUserToken(feeToken);await wait(p,tx.hash);record.feePreferenceTransaction=tx.hash;await save(record);}
  }
  if(!plan.deployed){
   if(record.factoryTransaction){const receipt=await p.getTransactionReceipt(record.factoryTransaction);if(!receipt)throw Error('Factory transaction remains pending; preserve checkpoint');if(receipt.status!==1)throw Error('Factory transaction failed; inspect checkpoint');}
   else{await save(record);const gas=await p.estimateGas({from:wallet.address,to:deterministicProxy,data:plan.data});const tx=await signer.sendTransaction({to:deterministicProxy,data:plan.data,gasLimit:gas*120n/100n});record.factoryTransaction=tx.hash;record.phase='factory pending';await save(record);await wait(p,tx.hash);}
  }
  if(!(await verifyDeployment(p,artifacts.PaymentFactory)).deployed)throw Error('Factory identity verification failed');record.phase='factory verified';await save(record);
  if(!record.token){
   if(record.tokenTransaction){const receipt=await p.getTransactionReceipt(record.tokenTransaction);if(!receipt)throw Error('Token transaction remains pending');if(receipt.status!==1)throw Error('Token transaction failed; inspect checkpoint');}
   if(record.tokenDeploymentAddress&&(await p.getCode(record.tokenDeploymentAddress))!=='0x'){
    record.faucet=chain==='tempo'?record.tokenDeploymentAddress:undefined;
    record.token=chain==='tempo'?await new Contract(record.faucet,artifacts.TempoTestUSD.abi,p).token():record.tokenDeploymentAddress;
   }else{
    const name=chain==='tempo'?'TempoTestUSD':'TestUSD',a=artifacts[name],nonce=await p.getTransactionCount(wallet.address,'pending');record.tokenDeploymentAddress=getCreateAddress({from:wallet.address,nonce});record.phase='token prepared';await save(record);
    const args=chain==='tempo'?[wallet.address,feeToken,id(`salute-test-${chain}-${record.createdAt}`)]:[wallet.address];
    const deployer=new ContractFactory(a.abi,a.bytecode,signer),unsigned=await deployer.getDeployTransaction(...args),gas=await p.estimateGas({...unsigned,from:wallet.address});const token=await deployer.deploy(...args,{gasLimit:gas*120n/100n});record.tokenTransaction=token.deploymentTransaction().hash;record.phase='token pending';await save(record);await wait(p,token.deploymentTransaction().hash);
    record.faucet=chain==='tempo'?record.tokenDeploymentAddress:undefined;record.token=chain==='tempo'?await token.token():record.tokenDeploymentAddress;
   }
  }
  if((await p.getCode(record.token))==='0x'||await new Contract(record.token,['function decimals() view returns(uint8)','function symbol() view returns(string)'],p).decimals()!==6n)throw Error('Test token verification failed');
  record.phase='complete';record.verifiedAt=new Date().toISOString();await save(record);
  registry.networks[chain]={chain,chainId:config.chainId,deployment:plan.factory,token:record.token,domain:'',feeToken,faucet:record.faucet,status:'ready',environment:'testnet',confirmations:2};await writeFile(registryPath,JSON.stringify(registry,null,2)+'\n');
  report.networks[chain]={status:'deployed',factory:plan.factory,token:record.token,faucet:record.faucet,factoryTransaction:record.factoryTransaction,tokenTransaction:record.tokenTransaction};console.log(`${chain}: factory and permissionless test token verified`);
 }catch(e){report.networks[chain]={status:'skipped',reason:e.shortMessage||e.code||e.message};console.log(`${chain}: skipped (${report.networks[chain].reason}); checkpoint preserved`);}finally{p?.destroy();}
}
await writeFile(new URL('../deployments/main-testnets.json',import.meta.url),JSON.stringify({...report,deployments:registry.networks},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
