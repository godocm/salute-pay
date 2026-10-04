import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async name => JSON.parse(await readFile(resolve(root, `artifacts/${name}.json`), 'utf8')).abi;
const [factoryAbi, forwarderAbi, tokenAbi] = await Promise.all(['PaymentFactory', 'PaymentForwarder', 'MockERC20'].map(read));
await mkdir(resolve(root, 'portal/lib'), { recursive: true });
await writeFile(resolve(root, 'portal/lib/protocol.json'), JSON.stringify({ factoryAbi, forwarderAbi, tokenAbi }, null, 2) + '\n');
console.log('Exported contract ABIs to portal/lib/protocol.json');
