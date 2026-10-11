import { readFile,writeFile,access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { JsonRpcProvider,Wallet,getAddress } from 'ethers';
import { catalog,loadEnvironment } from './testnet-config.mjs';
import { verifyDeployment } from './collection.mjs';
const args=process.argv.slice(2),broadcast=args.includes('--broadcast'),index=args.indexOf('--networks');
const env=await loadEnvironment(),selected=(index>=0?args[index+1]:env.TESTNET_NETWORKS||'tempo,solana').split(',');
if(new Set(selected).size!==selected.length||selected.some(c=>!['solana','tron',...Object.keys(catalog)].includes(c)))throw Error('Select supported unique networks.');
const run=(script,settings={},cwd=process.cwd())=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,...(broadcast?['--broadcast']:[])],{cwd,env:{...env,...settings},stdio:'inherit'});child.on('exit',code=>code===0?resolve():reject(Error('Deployment command failed; preserve and inspect its checkpoint.')));});
const artifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url),'utf8'));
const plans=[];
// Preflight every selected EVM network before any broadcast. This command never bootstraps a deployment proxy.
for(const chain of selected){
 if(!catalog[chain]){if(chain==='solana'&&(!env.SOLANA_DEPLOYER_KEYPAIR_PATH||!env.SOLANA_PROGRAM_KEYPAIR_PATH||!(env.SOLANA_MERCHANT_ADDRESS||env.MERCHANT_ADDRESS)))throw Error('Configure Solana deployer/program keypair paths and MERCHANT_ADDRESS.');if(chain==='tron'&&(!env.TRON_DEPLOYER_PRIVATE_KEY||!(env.TRON_MERCHANT_ADDRESS||env.MERCHANT_ADDRESS)))throw Error('Configure TRON_DEPLOYER_PRIVATE_KEY and MERCHANT_ADDRESS.');continue;}
 const c=catalog[chain],prefix=chain.toUpperCase(),rpc=env[`${prefix}_RPC_URL`]||c.rpc,key=env[`${prefix}_DEPLOYER_PRIVATE_KEY`]||env.EVM_DEPLOYER_PRIVATE_KEY;
 if(new URL(rpc).protocol!=='https:')throw Error(`${chain}: public deployment requires HTTPS RPC.`);
 const p=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});try{if(String((await p.getNetwork()).chainId)!==c.chainId)throw Error(`${chain}: RPC chain mismatch.`);const plan=await verifyDeployment(p,artifact);
 if(!plan.deployed&&broadcast){if(!key)throw Error(`${chain}: configure its deployer private key.`);const w=new Wallet(key,p);if(chain!=='tempo'&&await p.getBalance(w.address)===0n)throw Error(`${chain}: fund the deployer first.`);}
 plans.push({chain,...c,...plan,rpc,key});console.log(`${chain}: canonical factory ${plan.factory}; ${plan.deployed?'verified existing deployment':'ready to deploy'}`);
 }finally{p.destroy();}
}
// Native chain deployment scripts also preflight in dry-run mode before any broadcasts.
for(const chain of selected.filter(c=>!catalog[c])){const script=chain==='solana'?'solana/scripts/deploy.mjs':'tron/scripts/deploy.cjs';const child=spawn(process.execPath,[script],{env,cwd:process.cwd(),stdio:'inherit'});await new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve():reject(Error(`${chain}: preflight failed.`))));}
if(!broadcast){console.log('All selected preflights passed. No transactions sent. Explicit --broadcast deploys main implementations.');process.exit(0);}
const path=new URL('../portal/public/deployments/main.json',import.meta.url),registry=JSON.parse(await readFile(path,'utf8'));
for(const plan of plans){await run('scripts/deploy-collection.mjs',{RPC_URL:plan.rpc,EXPECTED_CHAIN_ID:plan.chainId,PRIVATE_KEY:plan.key||'',DEPLOY_OUTPUT:env[`${plan.chain.toUpperCase()}_DEPLOY_OUTPUT`]||`.data/deployments/${plan.chain}-main.json`});
 registry.networks[plan.chain]={chain:plan.chain,chainId:plan.chainId,deployment:plan.factory,token:env[`${plan.chain.toUpperCase()}_PAYMENT_TOKEN`]||plan.feeToken||'',domain:'',feeToken:plan.feeToken,status:'ready',environment:'testnet',confirmations:2};await writeFile(path,JSON.stringify(registry,null,2)+'\n');}
for(const chain of selected.filter(c=>!catalog[c])){await run(chain==='solana'?'solana/scripts/deploy.mjs':'tron/scripts/deploy.cjs');console.log(`${chain}: verify its complete checkpoint and activate with scripts/activate-network.mjs.`);}
