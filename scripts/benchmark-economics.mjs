// Isolated, valueless local benchmark. Never connects to a public chain.
import fs from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, id, parseEther } from 'ethers';
import { compileContracts } from './compile-contracts.mjs';

const artifacts = compileContracts();
const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 } });
const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, pollingInterval: 10 });
const [payer, merchant, executor, deposit, treasury, gasSponsor] = await Promise.all([0, 1, 2, 3, 4, 5].map(i => provider.getSigner(i)));
const measurements = [];
const record = async tx => Number((await (await tx).wait()).gasUsed);
async function deploy(name, args = []) {
  const contract = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, payer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function tokenFixture() {
  const token = await deploy('MockERC20', ['Benchmark USD', 'bUSD', 6]);
  await (await token.mint(payer.address, 1_000_000_000n)).wait();
  // Established treasury, while deposit, merchant and executor have zero token balance.
  await (await token.mint(treasury.address, 1n)).wait();
  return token;
}
function add(name, steps) {
  measurements.push({ name, transactions: steps.length, steps: steps.map(([name, gas]) => ({ name, gas })), totalGas: steps.reduce((sum, [,gas]) => sum + gas, 0) });
}
try {
  const factory = await deploy('PaymentFactory');
  const native = { id: id('benchmark-native'), merchant: merchant.address, token: ZeroAddress, amount: parseEther('1'), executorFee: parseEther('0.01') };
  const address = await factory.predictAddress(native);
  const nativeDeposit = await record(payer.sendTransaction({ to: address, value: native.amount }));
  const nativeSettle = await record(factory.connect(executor).settle(native));
  add('CREATE2 native, no announcement', [['customer deposit', nativeDeposit], ['deploy and split', nativeSettle]]);
  const nativeHop = await record(payer.sendTransaction({ to: deposit.address, value: parseEther('1') }));
  const nativeSweep = await record(deposit.sendTransaction({ to: treasury.address, value: parseEther('0.99') }));
  const nativeWithdrawal = await record(treasury.sendTransaction({ to: merchant.address, value: parseEther('0.98') }));
  add('HD native, deposit to treasury to merchant', [['customer deposit', nativeHop], ['sweep to treasury', nativeSweep], ['merchant withdrawal', nativeWithdrawal]]);
  add('HD native, direct merchant sweep', [['customer deposit', nativeHop], ['sweep to merchant', nativeSweep]]);

  const token = await tokenFixture();
  const order = { id: id('benchmark-token'), merchant: merchant.address, token: token.target, amount: 100_000_000n, executorFee: 1_000_000n };
  const tokenAddress = await factory.predictAddress(order);
  add('CREATE2 mock ERC20, no announcement', [
    ['customer deposit', await record(token.transfer(tokenAddress, order.amount))],
    ['deploy and two token payouts', await record(factory.connect(executor).settle(order))],
  ]);
  const hdToken = await tokenFixture();
  const hdDeposit = await record(hdToken.transfer(deposit.address, 100_000_000n));
  const funding = await record(gasSponsor.sendTransaction({ to: deposit.address, value: parseEther('0.001') }));
  const hdSweep = await record(hdToken.connect(deposit).transfer(treasury.address, 100_000_000n));
  const hdWithdrawal = await record(hdToken.connect(treasury).transfer(merchant.address, 100_000_000n));
  add('HD mock ERC20, gas top-up, treasury, merchant', [['customer deposit', hdDeposit], ['gas top-up', funding], ['sweep to established treasury', hdSweep], ['merchant withdrawal', hdWithdrawal]]);
  const directToken = await tokenFixture();
  add('HD mock ERC20, gas top-up, direct merchant', [
    ['customer deposit', await record(directToken.transfer(deposit.address, 100_000_000n))],
    ['gas top-up', funding],
    ['sweep to merchant', await record(directToken.connect(deposit).transfer(merchant.address, 100_000_000n))],
  ]);
  const result = {
    observedAt: new Date().toISOString(), network: 'isolated Ganache 7.9.2 / Shanghai', compiler: artifacts.PaymentFactory.compiler,
    assumptions: [
      'Gas used from receipts; native transfers target EOAs. No public-chain funds or keys.',
      'Native values simplified: this benchmarks transaction gas, not treasury accounting or residual dust.',
      'MockERC20 from pinned OpenZeppelin 5.4.0; no tax/rebase. Not mainnet USDC, USDT, TRON or Solana.',
      'Fresh deposit, merchant and executor token balances; established treasury seeded with one base unit.',
      'Setup mint/deploy and optional announcement excluded. HD gas top-up counts transaction gas, not transferred principal.',
      'One merchant withdrawal per payment; batching can reduce the HD amortized cost.',
      'Current fixed-fee protocol, no proposed signed-intent authentication or dynamic-reward overhead included.',
      'Executor reward is not an additional network fee: reward covers settlement cost plus profit/risk.',
    ], measurements,
  };
  fs.writeFileSync(new URL('../docs/ethereum-cost-benchmark.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await provider.destroy();
  await rpc.disconnect();
}
