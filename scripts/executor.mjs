import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, formatEther, getAddress, isHexString } from 'ethers';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const allowTokenFees = args.includes('--allow-token-fees');
const ordersIndex = args.indexOf('--orders');
const path = ordersIndex >= 0 ? args[ordersIndex + 1] : process.env.ORDERS_FILE;
const blockIndex = args.indexOf('--from-block');
const fromBlock = blockIndex >= 0 ? Number(args[blockIndex + 1]) : undefined;
async function main() {
  if (!process.env.RPC_URL || !process.env.FACTORY_ADDRESS || (!path && fromBlock === undefined)) throw new Error('Set RPC_URL, FACTORY_ADDRESS, and ORDERS_FILE (or --orders path, or --from-block N). Dry run is the default.');
  if (execute && !process.env.EXECUTOR_PRIVATE_KEY) throw new Error('--execute requires EXECUTOR_PRIVATE_KEY.');
  const factoryAbi = JSON.parse(await readFile(resolve(root, 'artifacts/PaymentFactory.json'), 'utf8')).abi;
  const forwarderAbi = JSON.parse(await readFile(resolve(root, 'artifacts/PaymentForwarder.json'), 'utf8')).abi;
  let input = path ? JSON.parse(await readFile(resolve(path), 'utf8')) : [];
  let rows = Array.isArray(input) ? input : Array.isArray(input.orders) ? input.orders : input.order || input.id ? [input] : null;
  if (!Array.isArray(rows) || rows.length > 10_000) throw new Error('Orders file must contain an order, an array, or {orders: [...]} with at most 10000 orders.');
  const provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  try {
    const signer = execute ? new Wallet(process.env.EXECUTOR_PRIVATE_KEY, provider) : null;
    const from = signer?.address || getAddress(process.env.EXECUTOR_ADDRESS || ZeroAddress);
    const network = await provider.getNetwork();
    if (process.env.EXPECTED_CHAIN_ID && network.chainId !== BigInt(process.env.EXPECTED_CHAIN_ID)) throw new Error('RPC chain does not match EXPECTED_CHAIN_ID.');
    const factory = new Contract(getAddress(process.env.FACTORY_ADDRESS), factoryAbi, signer || provider);
    if (await provider.getCode(await factory.getAddress()) === '0x') throw new Error('No factory code exists at FACTORY_ADDRESS.');
    const factoryAddress = await factory.getAddress();
    if (fromBlock !== undefined) {
      if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error('Order metadata from-block must be a non-negative integer.');
      const latest = await provider.getBlockNumber();
      if (latest - fromBlock > 100000) throw new Error('Order metadata scan exceeds 100000 blocks. Advance --from-block or use an indexed order file.');
      const discovered = new Map();
      for (let start = fromBlock; start <= latest; start += 2000) {
        const events = await factory.queryFilter(factory.filters.OrderAnnounced(), start, Math.min(start + 1999, latest));
        for (const event of events) {
          const x = event.args;
          discovered.set(x.deposit, {chainId: network.chainId.toString(), factory: factoryAddress, address:x.deposit, order:{id:x.orderId,merchant:x.merchant,token:x.token,amount:x.amount.toString(),executorFee:x.executorFee.toString()}});
        }
      }
      rows = [...rows, ...discovered.values()];
      if (rows.length > 10000) throw new Error('Orders file/discovery exceeds 10000 orders; use a narrower block range.');
      console.log(`Discovered ${discovered.size} merchant-announced orders from on-chain logs.`);
    }

    function checkContext(metadata) {
      if (!metadata || typeof metadata !== 'object') throw new Error('Order metadata is invalid.');
      if (metadata.chainId !== undefined && BigInt(metadata.chainId) !== network.chainId) throw new Error('Order metadata chainId does not match the connected chain.');
      if (metadata.factory !== undefined && getAddress(metadata.factory) !== factoryAddress) throw new Error('Order metadata factory does not match FACTORY_ADDRESS.');
      if (metadata.version !== undefined && metadata.version !== 1) throw new Error('Order metadata version is unsupported.');
    }
    if (!Array.isArray(input)) checkContext(input);
    // Validate the complete import before any transaction is sent.
    const prepared = [];
    for (const row of rows) {
      checkContext(row);
      const raw = row.order || row;
      if (!isHexString(raw.id, 32) || !/^\d+$/.test(String(raw.amount)) || !/^\d+$/.test(String(raw.executorFee))) throw new Error('Order metadata has an invalid id or amount.');
      const order = { id: raw.id, merchant: getAddress(raw.merchant), token: getAddress(raw.token), amount: BigInt(raw.amount), executorFee: BigInt(raw.executorFee) };
      if (order.amount <= 0n || order.executorFee >= order.amount || order.merchant === ZeroAddress) throw new Error('Order metadata contains invalid terms.');
      const deposit = await factory.predictAddress(order);
      if (row.address !== undefined && getAddress(row.address) !== deposit) throw new Error('Order metadata address does not match the computed deposit address.');
      prepared.push({ order, deposit });
    }
    console.log(`${execute ? 'EXECUTE' : 'DRY RUN'} | chain ${network.chainId} | ${prepared.length} orders`);
    for (const { order, deposit } of prepared) {
      try {
        const [balance, code] = await Promise.all([factory.balanceOf(order), provider.getCode(deposit)]);
        if (code !== '0x' && await new Contract(deposit, forwarderAbi, provider).settled()) { console.log(`${order.id}: already settled${balance > 0n ? '; late funds can be swept to merchant (no reward)' : ''}.`); continue; }
        if (balance < order.amount) { console.log(`${order.id}: waiting (${balance}/${order.amount} base units).`); continue; }
        const [gas, feeData] = await Promise.all([factory.settle.estimateGas(order, { from }), provider.getFeeData()]);
        const gasLimit = (gas * 120n + 99n) / 100n;
        const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
        if (!gasPrice) throw new Error('No gas price available.');
        const gasBudget = gasLimit * gasPrice;
        console.log(`${order.id}: ready | estimated gas ${gas} | 20% gas buffer budget ${formatEther(gasBudget)} native units.`);
        if (order.token === ZeroAddress) {
          console.log(`  reward ${formatEther(order.executorFee)} | budget margin ${formatEther(order.executorFee - gasBudget)} native units.`);
          if (order.executorFee <= gasBudget) { console.log('  skipped: reward does not cover the conservative gas budget.'); continue; }
        } else {
          console.log(`  ERC-20 reward ${order.executorFee} base units in ${order.token}; token value and conversion costs require independent pricing.`);
          if (execute && !allowTokenFees) { console.log('  skipped: review token economics and add --allow-token-fees to opt in.'); continue; }
        }
        if (!execute) { console.log('  dry run: no transaction sent.'); continue; }
        // State and gas prices can change; a competing executor may win the reward first.
        const feeCaps = feeData.maxFeePerGas != null
          ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n }
          : { gasPrice };
        const transaction = await factory.settle(order, { gasLimit, ...feeCaps });
        console.log(`  submitted ${transaction.hash}`);
        const receipt = await transaction.wait();
        console.log(`  confirmed in block ${receipt.blockNumber}; gas used ${receipt.gasUsed}.`);
      } catch (error) {
        console.error(`${order?.id || 'Invalid order'}: skipped (${error.code || error.name}); verify the tuple, funding, and factory.`);
      }
    }
  } finally { provider.destroy(); }
}
main().catch(error => {
  const known = ['Set RPC_URL', '--execute requires', 'Orders file', 'RPC chain', 'No factory code', 'Order metadata'];
  console.error(known.some(prefix => error.message?.startsWith(prefix)) ? error.message : `Executor failed (${error.code || error.name}). Check configuration and order data.`);
  process.exitCode = 1;
});
