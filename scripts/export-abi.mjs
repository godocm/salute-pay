import { readFile, writeFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(new URL(`../artifacts/${name}.json`,import.meta.url),'utf8')).abi;
const [factoryAbi,receiverAbi,tokenAbi] = await Promise.all(['PaymentFactory','PaymentReceiver','MockERC20'].map(read));
const factoryArtifact=JSON.parse(await readFile(new URL('../artifacts/PaymentFactory.json',import.meta.url),'utf8'));
const tronFactoryAbi=JSON.parse(await readFile(new URL('../tron/build/contracts/SaluteTronFactory.json',import.meta.url),'utf8')).abi;
await writeFile(new URL('../portal/lib/protocol.json',import.meta.url),JSON.stringify({factoryAbi,receiverAbi,tokenAbi,tronFactoryAbi,factoryArtifact},null,2)+'\n');
console.log('Exported main collection ABIs.');
