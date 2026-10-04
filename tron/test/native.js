const assert = require('node:assert/strict');
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const Factory = artifacts.require('SaluteTronFactory');
const Receiver = artifacts.require('SaluteTronReceiver');
const Token = artifacts.require('MockTRC20');

contract('SaluteTronFactory native CREATE2', accounts => {
  const demoOrders = [];
  after(() => {
    const data = resolve(__dirname, '../../.data/tron');
    mkdirSync(data, { recursive: true });
    writeFileSync(resolve(data, 'demo-orders.json'), JSON.stringify(demoOrders, null, 2) + '\n');
  });
  it('predicts a prefunded address and settles to fixed recipients', async () => {
    const factory = await Factory.new();
    const merchant = accounts[1];
    const order = [
      '0x' + '12'.repeat(32), merchant,
      '0x0000000000000000000000000000000000000000',
      '1000000', '100000',
    ];
    const deposit = await factory.predictAddress(order);
    const balanceBefore = await tronWeb.trx.getBalance(merchant);
    const payment = await tronWeb.trx.sendTransaction(deposit, 1200000);
    assert.ok(payment.result || payment.txid);
    assert.equal(String(await factory.balanceOf(order)), '1200000');
    const settlement = await factory.settle(order);
    const receiver = await Receiver.at(deposit);
    assert.equal(await receiver.settled(), true);
    const balanceAfter = await tronWeb.trx.getBalance(merchant);
    assert.equal(balanceAfter - balanceBefore, 1100000);
    assert.equal(await tronWeb.trx.getBalance(deposit), 0);
    demoOrders.push({ factory: factory.address, order, deposit, asset: 'TRX', decimals: 6,
      timeline: [{ step: 'deposit', txid: payment.txid }, { step: 'settled', txid: settlement }] });
  });

  it('binds terms, permits zero reward, and sweeps late TRX only to the merchant', async () => {
    const factory = await Factory.new();
    const merchant = accounts[1];
    const order = ['0x' + '34'.repeat(32), merchant,
      '0x0000000000000000000000000000000000000000', '200000', '0'];
    const changed = [...order]; changed[1] = accounts[2];
    const deposit = await factory.predictAddress(order);
    assert.notEqual(await factory.predictAddress(changed), deposit);
    const payment = await tronWeb.trx.sendTransaction(deposit, 200000);
    const before = await tronWeb.trx.getBalance(merchant);
    const settlement = await factory.settle(order);
    assert.equal((await tronWeb.trx.getBalance(merchant)) - before, 200000);
    const latePayment = await tronWeb.trx.sendTransaction(deposit, 50000);
    const lateBefore = await tronWeb.trx.getBalance(merchant);
    const lateSweep = await factory.settle(order);
    assert.equal((await tronWeb.trx.getBalance(merchant)) - lateBefore, 50000);
    assert.equal(await tronWeb.trx.getBalance(deposit), 0);
    demoOrders.push({ factory: factory.address, order, deposit, asset: 'TRX', decimals: 6,
      timeline: [{ step: 'deposit', txid: payment.txid }, { step: 'settled', txid: settlement },
        { step: 'late_deposit', txid: latePayment.txid }, { step: 'late_sweep', txid: lateSweep }] });
  });

  it('keeps an underpaid receiver undeployed and rejects direct execution', async () => {
    const factory = await Factory.new();
    const order = ['0x' + '78'.repeat(32), accounts[1],
      '0x0000000000000000000000000000000000000000', '1000000', '100000'];
    const deposit = await factory.predictAddress(order);
    await tronWeb.trx.sendTransaction(deposit, 400000);
    const underpaidTx = await factory.settle(order);
    assert.notEqual((await tronWeb.trx.getTransactionInfo(underpaidTx)).receipt?.result, 'SUCCESS');
    assert.equal(String(await factory.balanceOf(order)), '400000');
    await tronWeb.trx.sendTransaction(deposit, 600000);
    await factory.settle(order);
    const receiver = await Receiver.at(deposit);
    const directTx = await receiver.execute(accounts[0]);
    assert.notEqual((await tronWeb.trx.getTransactionInfo(directTx)).receipt?.result, 'SUCCESS');
    assert.equal(await receiver.settled(), true);
  });

  it('settles a prefunded TRC-20 order with fixed reward and surplus', async () => {
    const factory = await Factory.new();
    const token = await Token.new();
    const merchant = accounts[1];
    const executor = accounts[0];
    const order = ['0x' + '56'.repeat(32), merchant, token.address, '1000000', '100000'];
    const deposit = await factory.predictAddress(order);
    await token.mint(executor, 2000000);
    const payment = await token.transfer(deposit, 1200000);
    assert.equal(String(await factory.balanceOf(order)), '1200000');
    const settlement = await factory.settle(order);
    assert.equal(String(await token.balanceOf(merchant)), '1100000');
    assert.equal(String(await token.balanceOf(executor)), '900000');
    assert.equal(String(await token.balanceOf(deposit)), '0');
    const latePayment = await token.transfer(deposit, 100000);
    const lateSweep = await factory.settle(order);
    assert.equal(String(await token.balanceOf(merchant)), '1200000');
    assert.equal(String(await token.balanceOf(executor)), '800000');
    demoOrders.push({ factory: factory.address, order, deposit, asset: 'TRC20', decimals: 18,
      timeline: [{ step: 'deposit', txid: payment }, { step: 'settled', txid: settlement },
        { step: 'late_deposit', txid: latePayment }, { step: 'late_sweep', txid: lateSweep }] });
  });
});
