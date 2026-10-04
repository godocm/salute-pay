import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const broadcast = process.argv.includes('--broadcast');
async function main() {
  if (!process.env.RPC_URL || !process.env.PRIVATE_KEY) throw new Error('Set RPC_URL and PRIVATE_KEY explicitly. Default is estimate-only; add --broadcast to deploy.');
  const compiled = spawnSync(process.execPath, [resolve(root, 'scripts/compile-contracts.mjs')], { cwd: root, stdio: 'inherit' });
  if (compiled.status !== 0) throw new Error('Contract compilation failed.');
  const artifact = JSON.parse(await readFile(resolve(root, 'artifacts/PaymentFactory.json'), 'utf8'));
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  try {
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    const network = await provider.getNetwork();
    if (process.env.EXPECTED_CHAIN_ID && network.chainId !== BigInt(process.env.EXPECTED_CHAIN_ID)) throw new Error('RPC chain does not match EXPECTED_CHAIN_ID.');
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const request = await factory.getDeployTransaction();
    const [gas, fees] = await Promise.all([provider.estimateGas({ ...request, from: wallet.address }), provider.getFeeData()]);
    const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
    console.log(`Chain ${network.chainId} | deployer ${wallet.address} | estimated gas ${gas}`);
    if (gasPrice) console.log(`Estimated maximum fee at the current fee quote: ${formatEther(gas * gasPrice)} native units.`);
    if (!broadcast) { console.log('Dry run complete. Add --broadcast to deploy the factory and its implementation.'); return; }
    const contract = await factory.deploy();
    console.log(`Deployment transaction: ${contract.deploymentTransaction().hash}`);
    await contract.waitForDeployment();
    const record = { chainId: network.chainId.toString(), factory: await contract.getAddress(), implementation: await contract.implementation(), deployer: wallet.address, transactionHash: contract.deploymentTransaction().hash, deployedAt: new Date().toISOString() };
    const output = process.env.DEPLOY_OUTPUT ? resolve(process.env.DEPLOY_OUTPUT) : resolve(root, 'deployments', `${network.chainId}-${record.factory}.json`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(`Factory ${record.factory}\nDeployment metadata: ${output}`);
  } finally { provider.destroy(); }
}
main().catch(error => {
  const known = ['Set RPC_URL', 'Contract compilation', 'RPC chain'];
  console.error(known.some(prefix => error.message?.startsWith(prefix)) ? error.message : `Deployment failed (${error.code || error.name}). Check RPC connectivity, funds, and your settings.`);
  process.exitCode = 1;
});
