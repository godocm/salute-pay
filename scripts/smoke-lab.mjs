import assert from 'node:assert/strict';
import { Contract, JsonRpcProvider, parseUnits } from 'ethers';
const base = 'http://127.0.0.1:8787';
const origin = 'http://127.0.0.1:5173';
async function call(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: body ? { origin, 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
const config = await call('/api/config');
assert.equal(config.chainId, 31337);
const provider = new JsonRpcProvider(config.rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
try {
  const token = new Contract(config.token, config.tokenAbi, provider);
  let eth = await call('/api/orders', { label: 'Smoke: native ETH', asset: 'ETH', amount: '0.01', executorFee: '0.001' });
  assert.equal(eth.status, 'awaiting');
  assert.equal(await provider.getCode(eth.address), '0x');
  eth = await call(`/api/orders/${eth.order.id}/pay`, { amount: '0.004' });
  assert.equal(eth.status, 'partial');
  const notReady = await fetch(`${base}/api/orders/${eth.order.id}/settle`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(notReady.status, 400);
  eth = await call(`/api/orders/${eth.order.id}/pay`, { amount: '0.006' });
  assert.equal(eth.status, 'ready');
  assert.equal(eth.deployed, false);
  const merchantBefore = await provider.getBalance(config.merchant);
  eth = await call(`/api/orders/${eth.order.id}/settle`, {});
  assert.equal(eth.status, 'settled');
  assert.equal(eth.deployed, true);
  assert.equal(eth.balance, '0');
  assert.equal(await provider.getBalance(config.merchant) - merchantBefore, parseUnits('0.009', 18));
  let usdc = await call('/api/orders', { label: 'Smoke: token USDC', asset: 'USDC', amount: '20', executorFee: '0.25' });
  usdc = await call(`/api/orders/${usdc.order.id}/pay`, {});
  assert.equal(usdc.status, 'ready');
  const tokenBefore = await token.balanceOf(config.merchant);
  usdc = await call(`/api/orders/${usdc.order.id}/settle`, {});
  assert.equal(usdc.status, 'settled');
  assert.equal(await token.balanceOf(config.merchant) - tokenBefore, parseUnits('19.75', 6));
  await call(`/api/orders/${eth.order.id}/pay`, { amount: '0.002' });
  const lateBefore = await provider.getBalance(config.merchant);
  await call(`/api/orders/${eth.order.id}/settle`, {});
  assert.equal(await provider.getBalance(config.merchant) - lateBefore, parseUnits('0.002', 18));
  for (const invalidOrigin of ['https://evil.example', 'http://localhost:9999', undefined]) {
    const headers = { 'content-type': 'application/json' };
    if (invalidOrigin) headers.origin = invalidOrigin;
    const response = await fetch(`${base}/api/orders`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 403);
  }
  const rows = await call('/api/orders');
  assert.ok(rows.some(row => row.order.id === eth.order.id));
  console.log('PASS: ETH partial funding, predeployment address, permissionless settlement, USDC split, late deposits, SQLite records, and API origin restrictions.');
} finally { provider.destroy(); }
