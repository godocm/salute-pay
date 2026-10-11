import { AbiCoder, concat, getAddress, getCreate2Address, getCreateAddress, id, keccak256, TypedDataEncoder, zeroPadValue, toBeHex, toUtf8Bytes, getBytes } from 'ethers';

// Pinned canonical proxy runtime from Arachnid/deterministic-deployment-proxy's published deployment transaction.
export const deterministicProxy = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
export const deterministicProxyRuntime = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
export const factorySalt = id('Salute Payment Collection Factory v4');
export const portableOrderTypes = { PortableOrder: [
  {name:'id',type:'bytes32'}, {name:'merchant',type:'address'}, {name:'token',type:'address'},
  {name:'amount',type:'uint256'}, {name:'executorFee',type:'uint256'}, {name:'originChainId',type:'uint256'},
] };
export const authorizationTypes = { CollectionAuthorization: [
  {name:'orderDigest',type:'bytes32'}, {name:'asset',type:'address'}, {name:'reward',type:'uint256'},
  {name:'minimumMerchantAmount',type:'uint256'}, {name:'nonce',type:'bytes32'}, {name:'deadline',type:'uint256'},
] };
export const domain = (factory, chainId) => ({name:'Salute',version:'4',chainId:BigInt(chainId),verifyingContract:getAddress(factory)});
export const portableDigest = (factory, order) => TypedDataEncoder.hash(domain(factory,order.originChainId),portableOrderTypes,order);
export const rewardDigest = (factory, chainId, authorization) => TypedDataEncoder.hash(domain(factory,chainId),authorizationTypes,authorization);
export function receiverAddress(factory,implementation,order) {
  const args=AbiCoder.defaultAbiCoder().encode(['tuple(bytes32 id,address merchant,address token,uint256 amount,uint256 executorFee,uint256 originChainId)'],[order]);
  const salt=keccak256(concat([toUtf8Bytes('SALUTE_COLLECTION_V4'),args]));
  // OpenZeppelin 5.4 clone-with-immutable-arguments initialization code, pinned by the compiler dependency.
  const initCode=concat(['0x61',toBeHex(getBytes(args).length+45,2),'0x3d81600a3d39f3363d3d373d3d3d363d73',implementation,'0x5af43d82803e903d91602b57fd5bf3',args]);
  return getCreate2Address(factory,salt,keccak256(initCode));
}
export const deploymentPlan = artifact => {
  const address=getCreate2Address(deterministicProxy,factorySalt,keccak256(artifact.bytecode));
  return {factory:address,implementation:getCreateAddress({from:address,nonce:1}),data:concat([factorySalt,artifact.bytecode]),initCodeHash:keccak256(artifact.bytecode)};
};
export function expectedFactoryRuntime(artifact) {
  const plan=deploymentPlan(artifact),refs=Object.values(artifact.immutableReferences||{});
  if(refs.length!==1)throw Error('Factory artifact must expose its sole implementation immutable. Recompile first.');
  let runtime=artifact.deployedBytecode.slice(2);
  for(const {start,length} of refs[0]){
    if(length!==32)throw Error('Unexpected immutable layout.');
    runtime=runtime.slice(0,start*2)+zeroPadValue(plan.implementation,32).slice(2)+runtime.slice((start+length)*2);
  }
  return '0x'+runtime;
}
export async function verifyDeployment(provider,artifact) {
  const plan=deploymentPlan(artifact);
  const proxyCode=await provider.getCode(deterministicProxy);
  if(keccak256(proxyCode)!==keccak256(deterministicProxyRuntime))throw Error('Canonical deterministic proxy is absent or has unexpected code. No transactions sent.');
  const code=await provider.getCode(plan.factory);
  if(code!=='0x' && keccak256(code)!==keccak256(expectedFactoryRuntime(artifact)))throw Error('Canonical factory address contains unexpected code. No transactions sent.');
  return {...plan,deployed:code!=='0x'};
}
