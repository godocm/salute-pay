import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, ZeroAddress, id, parseEther } from 'ethers';
import { compileContracts } from '../scripts/compile-contracts.mjs';

const artifacts = compileContracts();
const gas = {};
let rpc, provider, factory, token, owner, merchant, executor, other;
let orderNumber = 0;
const gross = parseEther('1');
const reward = parseEther('0.01');

function order(overrides = {}) {
  return {
    id: id(`test-order-${++orderNumber}`),
    merchant: merchant.address,
    token: ZeroAddress,
    amount: gross,
    executorFee: reward,
    ...overrides,
  };
}

async function deploy(name, args = [], signer = owner) {
  const instance = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, signer).deploy(...args);
  await instance.waitForDeployment();
  return instance;
}

async function balance(address) {
  return BigInt(await provider.send('eth_getBalance', [address, 'latest']));
}

async function code(address) {
  return provider.send('eth_getCode', [address, 'latest']);
}

async function pay(address, value) {
  return (await owner.sendTransaction({ to: address, value })).wait();
}

async function settle(invoice, signer = executor) {
  return (await factory.connect(signer).settle(invoice)).wait();
}

function forwarder(address) {
  return new Contract(address, artifacts.PaymentForwarder.abi, provider);
}

async function rejectsTransaction(operation) {
  await assert.rejects(async () => {
    const tx = await operation();
    if (tx?.wait) await tx.wait();
  });
}

before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 },
  });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, pollingInterval: 10 });
  [owner, merchant, executor, other] = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  factory = await deploy('PaymentFactory');
  gas.factoryDeployment = Number((await factory.deploymentTransaction().wait()).gasUsed);
  token = await deploy('MockERC20', ['Test USD', 'tUSD', 6]);
});

after(async () => {
  fs.writeFileSync(new URL('../artifacts/gas-report.json', import.meta.url), JSON.stringify({
    network: 'Ganache / Shanghai',
    compiler: artifacts.PaymentFactory.compiler,
    optimizerRuns: 200,
    viaIR: true,
    cloneRuntimeBytes: 181,
    gas,
    note: 'Measured gas units, not a live fee quote. Settlement gas excludes the payer deposit and any approval transaction. Fresh recipients and token balances affect gas. ETH/ERC20 settlement includes CREATE2 deployment and both transfers.',
  }, null, 2) + '\n');
  await provider?.destroy();
  await rpc?.disconnect();
});

test('predicts a stable empty address and rejects unfunded or partial deposits without deployment', async () => {
  const invoice = order();
  const address = await factory.predictAddress(invoice);
  assert.equal(await factory.predictAddress(invoice), address);
  assert.equal(await code(address), '0x');
  await rejectsTransaction(() => factory.connect(executor).settle(invoice));
  await pay(address, gross - 1n);
  assert.equal(await factory.balanceOf(invoice), gross - 1n);
  await rejectsTransaction(() => factory.connect(executor).settle(invoice));
  assert.equal(await code(address), '0x');
  assert.equal(await balance(address), gross - 1n);
  await pay(address, 1n);
  await settle(invoice);
  assert.equal(await forwarder(address).settled(), true);
});

test('atomically deploys a minimal clone and splits native ETH plus all excess correctly', async () => {
  const invoice = order();
  const address = await factory.predictAddress(invoice);
  const surplus = parseEther('0.4');
  const depositReceipt = await pay(address, gross + surplus);
  gas.nativeDepositBeforeDeployment = Number(depositReceipt.gasUsed);
  const beforeMerchant = await balance(merchant.address);
  const beforeExecutor = await balance(executor.address);
  const receipt = await settle(invoice);
  gas.nativeFirstSettlement = Number(receipt.gasUsed);
  assert.equal(await balance(merchant.address) - beforeMerchant, gross + surplus - reward);
  assert.equal(await balance(executor.address) - beforeExecutor + receipt.fee, reward);
  assert.equal(await balance(address), 0n);
  assert.equal((await code(address)).slice(2).length / 2, 181);
  const stored = await forwarder(address).getOrder();
  assert.deepEqual([...stored], Object.values(invoice));
  const event = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'PaymentSettled');
  assert.equal(event.args.orderId, invoice.id);
  assert.equal(event.args.deposit, address);
  assert.equal(event.args.requiredAmount, gross);
  assert.equal(event.args.merchantAmount, gross + surplus - reward);
  assert.equal(event.args.executorFee, reward);
  assert.equal(event.args.executor, executor.address);
});

test('supports ERC20 transfer-before-deploy, partial funding, a six-decimal token, and excess', async () => {
  const invoice = order({ token: token.target, amount: 100_000_000n, executorFee: 200_000n });
  const address = await factory.predictAddress(invoice);
  await (await token.mint(owner.address, 110_000_000n)).wait();
  const depositReceipt = await (await token.transfer(address, 50_000_000n)).wait();
  gas.erc20DepositBeforeDeployment = Number(depositReceipt.gasUsed);
  await rejectsTransaction(() => factory.connect(executor).settle(invoice));
  assert.equal(await code(address), '0x');
  await (await token.transfer(address, 60_000_000n)).wait();
  const beforeMerchant = await token.balanceOf(merchant.address);
  const beforeExecutor = await token.balanceOf(executor.address);
  const receipt = await settle(invoice);
  gas.erc20FirstSettlement = Number(receipt.gasUsed);
  assert.equal(await token.balanceOf(merchant.address) - beforeMerchant, 109_800_000n);
  assert.equal(await token.balanceOf(executor.address) - beforeExecutor, 200_000n);
  assert.equal(await token.balanceOf(address), 0n);
  assert.deepEqual([...(await forwarder(address).getOrder())], Object.values(invoice));
});

test('binds order ID, merchant, token, amount, fee, and chain to the counterfactual address', async () => {
  const invoice = order();
  const original = await factory.predictAddress(invoice);
  const mutations = [
    { id: id('different-id') }, { merchant: other.address }, { token: token.target },
    { amount: gross + 1n }, { executorFee: reward + 1n },
  ];
  for (const mutation of mutations) assert.notEqual(await factory.predictAddress({ ...invoice, ...mutation }), original);
  const rpc2 = ganache.provider({
    logging: { quiet: true }, chain: { chainId: 1338, hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 },
  });
  const provider2 = new BrowserProvider(rpc2, undefined, { cacheTimeout: -1, pollingInterval: 10 });
  try {
    const secondFactory = await deploy('PaymentFactory', [], await provider2.getSigner(0));
    assert.equal(secondFactory.target, factory.target, 'same deployer nonce gives identical factory on another chain');
    assert.notEqual(await secondFactory.predictAddress(invoice), original, 'chain ID changes the payment address');
  } finally {
    await provider2.destroy();
    await rpc2.disconnect();
  }
});

test('rejects invalid merchant addresses, zero amount, and fee consuming the whole payment', async () => {
  for (const mutation of [
    { merchant: ZeroAddress }, { merchant: factory.target }, { merchant: await factory.implementation() },
    { amount: 0n, executorFee: 0n }, { executorFee: gross }, { executorFee: gross + 1n },
  ]) {
    const invoice = order(mutation);
    await assert.rejects(() => factory.predictAddress(invoice));
    await rejectsTransaction(() => factory.settle(invoice));
  }
});

test('fee can be zero and a merchant can execute its own settlement', async () => {
  const noFee = order({ executorFee: 0n });
  const noFeeAddress = await factory.predictAddress(noFee);
  await pay(noFeeAddress, gross);
  const before = await balance(merchant.address);
  await settle(noFee);
  assert.equal(await balance(merchant.address) - before, gross);

  const self = order();
  await pay(await factory.predictAddress(self), gross);
  const beforeSelf = await balance(merchant.address);
  const receipt = await settle(self, merchant);
  gas.nativeMerchantSelfSettlement = Number(receipt.gasUsed);
  assert.equal(await balance(merchant.address) - beforeSelf + receipt.fee, gross);
});

test('late native deposits go entirely to merchant and never pay a second executor reward', async () => {
  const invoice = order();
  const address = await factory.predictAddress(invoice);
  await pay(address, gross);
  await settle(invoice);
  await rejectsTransaction(() => factory.connect(other).settle(invoice));
  const late = parseEther('0.05');
  await pay(address, late);
  const beforeMerchant = await balance(merchant.address);
  const beforeExecutor = await balance(other.address);
  const receipt = await settle(invoice, other);
  gas.nativeLateSweep = Number(receipt.gasUsed);
  assert.equal(await balance(merchant.address) - beforeMerchant, late);
  assert.equal(await balance(other.address) - beforeExecutor + receipt.fee, 0n);
  assert.equal(await balance(address), 0n);
  const event = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'LatePaymentSwept');
  assert.equal(event.args.amount, late);
});

test('late ERC20 deposits go entirely to merchant even below the original invoice amount', async () => {
  const invoice = order({ token: token.target, amount: 1000n, executorFee: 10n });
  const address = await factory.predictAddress(invoice);
  await (await token.mint(address, 1000n)).wait();
  await settle(invoice);
  await (await token.mint(address, 1n)).wait();
  const beforeMerchant = await token.balanceOf(merchant.address);
  const beforeExecutor = await token.balanceOf(other.address);
  const receipt = await settle(invoice, other);
  gas.erc20LateSweep = Number(receipt.gasUsed);
  assert.equal(await token.balanceOf(merchant.address) - beforeMerchant, 1n);
  assert.equal(await token.balanceOf(other.address), beforeExecutor);
});

test('changing terms cannot redirect existing funds; direct clone/implementation calls cannot pay an attacker', async () => {
  const invoice = order();
  const address = await factory.predictAddress(invoice);
  await pay(address, gross);
  await rejectsTransaction(() => factory.connect(other).settle({ ...invoice, merchant: other.address }));
  assert.equal(await balance(address), gross);
  const implementation = forwarder(await factory.implementation()).connect(other);
  await rejectsTransaction(() => implementation.execute(other.address, true));
  await assert.rejects(() => implementation.getOrder());
  await rejectsTransaction(() => other.sendTransaction({ to: implementation.target, value: 1n }));
  await settle(invoice);
  await pay(address, 100n);
  await rejectsTransaction(() => forwarder(address).connect(other).execute(other.address, true));
  assert.equal(await balance(address), 100n);
  const before = await balance(merchant.address);
  await settle(invoice, other);
  assert.equal(await balance(merchant.address) - before, 100n);
});

test('native merchant callbacks cannot reenter the same settlement and double-claim the fee', async () => {
  const recipient = await deploy('AdversarialRecipient');
  const invoice = order({ merchant: recipient.target });
  const address = await factory.predictAddress(invoice);
  await (await recipient.configure(factory.target, factory.interface.encodeFunctionData('settle', [invoice]), false)).wait();
  await pay(address, gross);
  const beforeExecutor = await balance(executor.address);
  const receipt = await settle(invoice);
  assert.equal(await recipient.attempted(), true);
  assert.equal(await recipient.reentrySucceeded(), false);
  assert.equal(await balance(recipient.target), gross - reward);
  assert.equal(await balance(executor.address) - beforeExecutor + receipt.fee, reward);
});

test('native callbacks cannot reenter a separate funded order', async () => {
  const recipient = await deploy('AdversarialRecipient');
  const first = order({ merchant: recipient.target });
  const second = order();
  const secondAddress = await factory.predictAddress(second);
  await pay(await factory.predictAddress(first), gross);
  await pay(secondAddress, gross);
  await (await recipient.configure(factory.target, factory.interface.encodeFunctionData('settle', [second]), false)).wait();
  await settle(first);
  assert.equal(await recipient.attempted(), true);
  assert.equal(await recipient.reentrySucceeded(), false);
  assert.equal(await code(secondAddress), '0x');
  assert.equal(await balance(secondAddress), gross);
  await settle(second);
});

test('malicious ERC20 transfer callbacks cannot reenter settlement', async () => {
  const evilToken = await deploy('AdversarialToken');
  const invoice = order({ token: evilToken.target });
  const address = await factory.predictAddress(invoice);
  await (await evilToken.mint(address, gross)).wait();
  await (await evilToken.configure(factory.target, factory.interface.encodeFunctionData('settle', [invoice]), false)).wait();
  await settle(invoice);
  assert.equal(await evilToken.attempted(), true);
  assert.equal(await evilToken.reentrySucceeded(), false);
  assert.equal(await evilToken.balanceOf(merchant.address), gross - reward);
  assert.equal(await evilToken.balanceOf(executor.address), reward);
});

test('failed merchant native transfer rolls back clone deployment and preserves the entire deposit for retry', async () => {
  const recipient = await deploy('AdversarialRecipient');
  const invoice = order({ merchant: recipient.target });
  const address = await factory.predictAddress(invoice);
  await (await recipient.configure(ZeroAddress, '0x', true)).wait();
  await pay(address, gross);
  await rejectsTransaction(() => factory.connect(executor).settle(invoice, { gasLimit: 500_000n }));
  assert.equal(await code(address), '0x');
  assert.equal(await balance(address), gross);
  await (await recipient.configure(ZeroAddress, '0x', false)).wait();
  await settle(invoice);
  assert.equal(await balance(recipient.target), gross - reward);
});

test('failed executor native transfer rolls back merchant payment and can be retried by another executor', async () => {
  const recipient = await deploy('AdversarialRecipient');
  const invoice = order();
  const address = await factory.predictAddress(invoice);
  await (await recipient.configure(ZeroAddress, '0x', true)).wait();
  await pay(address, gross);
  const beforeMerchant = await balance(merchant.address);
  await rejectsTransaction(() => recipient.run(factory.target, factory.interface.encodeFunctionData('settle', [invoice]), { gasLimit: 500_000n }));
  assert.equal(await code(address), '0x');
  assert.equal(await balance(address), gross);
  assert.equal(await balance(merchant.address), beforeMerchant);
  await settle(invoice);
  assert.equal(await balance(merchant.address) - beforeMerchant, gross - reward);
});

test('failed token transfer rolls back deployment and leaves funding retryable', async () => {
  const evilToken = await deploy('AdversarialToken');
  const invoice = order({ token: evilToken.target });
  const address = await factory.predictAddress(invoice);
  await (await evilToken.mint(address, gross)).wait();
  await (await evilToken.configure(ZeroAddress, '0x', true)).wait();
  await rejectsTransaction(() => factory.connect(executor).settle(invoice, { gasLimit: 500_000n }));
  assert.equal(await code(address), '0x');
  assert.equal(await evilToken.balanceOf(address), gross);
  assert.equal(await evilToken.balanceOf(merchant.address), 0n);
  await (await evilToken.configure(ZeroAddress, '0x', false)).wait();
  await settle(invoice);
  assert.equal(await forwarder(address).settled(), true);
});

test('a token returning false cannot mark settlement successful or consume the deposit', async () => {
  const falseToken = await deploy('FalseReturnToken');
  const invoice = order({ token: falseToken.target });
  const address = await factory.predictAddress(invoice);
  await (await falseToken.mint(address, gross)).wait();
  await rejectsTransaction(() => factory.connect(executor).settle(invoice, { gasLimit: 500_000n }));
  assert.equal(await code(address), '0x');
  assert.equal(await falseToken.balanceOf(address), gross);
  assert.equal(await falseToken.balanceOf(merchant.address), 0n);
  assert.equal(await falseToken.balanceOf(executor.address), 0n);
});

test('SafeERC20 supports otherwise conventional tokens whose transfer has no return value', async () => {
  const noReturnToken = await deploy('NoReturnToken');
  const invoice = order({ token: noReturnToken.target });
  const address = await factory.predictAddress(invoice);
  await (await noReturnToken.mint(address, gross)).wait();
  await settle(invoice);
  assert.equal(await noReturnToken.balanceOf(address), 0n);
  assert.equal(await noReturnToken.balanceOf(merchant.address), gross - reward);
  assert.equal(await noReturnToken.balanceOf(executor.address), reward);
});

test('merchant can announce discoverable order terms without deploying; others cannot impersonate', async () => {
  const invoice = order();
  const deposit = await factory.predictAddress(invoice);
  await rejectsTransaction(() => factory.connect(other).announce(invoice));
  const receipt = await (await factory.connect(merchant).announce(invoice)).wait();
  gas.orderAnnouncement = Number(receipt.gasUsed);
  assert.equal(await code(deposit), '0x');
  const event = receipt.logs.map(log => factory.interface.parseLog(log)).find(log => log.name === 'OrderAnnounced');
  assert.equal(event.args.deposit, deposit);
  assert.deepEqual([event.args.orderId, event.args.merchant, event.args.token, event.args.amount, event.args.executorFee], Object.values(invoice));
  // Re-announcement cannot reserve or modify the payout address.
  await (await factory.connect(merchant).announce(invoice)).wait();
  await pay(deposit, gross);
  await settle(invoice);
  assert.equal(await forwarder(deposit).settled(), true);
});
