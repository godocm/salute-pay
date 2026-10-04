const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { TronWeb } = require('tronweb');

// Read-only local TRE observer. The test writes a fixture index; balances and
// settlement state are rechecked against the chain on every request.
const port = Number(process.env.TRON_OBSERVER_PORT || 8791);
const fullHost = process.env.TRON_FULL_NODE_URL || 'http://127.0.0.1:9090';
const tronWeb = new TronWeb({ fullHost });
const factoryAbi = JSON.parse(readFileSync(resolve(__dirname, '../build/contracts/SaluteTronFactory.json'))).abi;
const receiverAbi = JSON.parse(readFileSync(resolve(__dirname, '../build/contracts/SaluteTronReceiver.json'))).abi;
const ordersPath = resolve(__dirname, '../../.data/tron/demo-orders.json');
const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']);
function base58(address) {
  if (address.startsWith('0x')) return tronWeb.address.fromHex('41' + address.slice(2));
  if (address.startsWith('41')) return tronWeb.address.fromHex(address);
  return address;
}
const publicCaller = JSON.parse(readFileSync(ordersPath))[0]?.order?.[1];
if (!publicCaller) throw new Error('Run the local TronBox tests first to create demo orders.');
tronWeb.setAddress(base58(publicCaller));
async function view(row) {
  // Constant TVM calls still require a public owner_address; no key is loaded.
  const factory = await tronWeb.contract(factoryAbi, base58(row.factory));
  const receiver = await tronWeb.contract(receiverAbi, base58(row.deposit));
  const [balanceValue, settledValue, timeline] = await Promise.all([
    factory.balanceOf(row.order).call(), receiver.settled().call(),
    Promise.all(row.timeline.map(async entry => {
      const info = await tronWeb.trx.getTransactionInfo(entry.txid);
      return { step: entry.step, txid: entry.txid, blockNumber: info.blockNumber || null,
        status: info.receipt?.result === 'SUCCESS' ? 'confirmed' : info.receipt?.result ? 'failed' : 'pending' };
    })),
  ]);
  const balance = BigInt(balanceValue.toString());
  const amount = BigInt(row.order[3]);
  const settled = Boolean(settledValue);
  return {
    network: 'tron', factory: base58(row.factory), orderId: row.order[0],
    merchant: base58(row.order[1]), token: row.asset === 'TRX' ? null : base58(row.order[2]),
    asset: row.asset, decimals: row.decimals, amount: amount.toString(), executorReward: row.order[4],
    depositAddress: base58(row.deposit), balance: balance.toString(), settled,
    status: settled ? balance > 0n ? 'late_funds' : 'settled' : balance >= amount ? 'ready' : balance > 0n ? 'partial' : 'awaiting',
    timeline,
  };
}
const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return reply(res, 403, { error: 'Unrecognized Host.' });
    if (req.headers.origin && !origins.has(req.headers.origin)) return reply(res, 403, { error: 'Origin is not allowed.' });
    if (req.headers.origin) { res.setHeader('access-control-allow-origin', req.headers.origin); res.setHeader('vary', 'Origin'); }
    if (req.method !== 'GET') return reply(res, 405, { error: 'Read-only observer.' });
    if (req.url !== '/api/tron/orders') return reply(res, 404, { error: 'Not found.' });
    const rows = JSON.parse(readFileSync(ordersPath));
    return reply(res, 200, await Promise.all(rows.map(view)));
  } catch (error) { console.error('[TRON observer]', error); if (!res.headersSent) reply(res, 500, { error: 'Could not verify TRON chain state.' }); }
}).listen(port, '127.0.0.1', () => console.log(`Read-only TRON observer: http://127.0.0.1:${port} | ${fullHost}`));
