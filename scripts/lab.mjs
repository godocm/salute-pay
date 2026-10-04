import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import ganache from 'ganache';
import { Contract, ContractFactory, JsonRpcProvider, ZeroAddress, formatUnits, getAddress, hexlify, keccak256, parseUnits, randomBytes } from 'ethers';

// Deliberately public development accounts. NEVER fund these accounts on a public chain.
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, '.data');
const API_PORT = 8787;
const RPC_PORT = 8545;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const allowedOrigins = new Set(['localhost', '127.0.0.1'].flatMap(host => [3000, 5173, 8787].map(port => `http://${host}:${port}`)));
const factoryPath = resolve(ROOT, 'artifacts/PaymentFactory.json');
const compile = spawnSync(process.execPath, [resolve(ROOT, 'scripts/compile-contracts.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status || 1);
await mkdir(DATA, { recursive: true });
const factoryArtifact = JSON.parse(await readFile(factoryPath, 'utf8'));
const forwarderArtifact = JSON.parse(await readFile(resolve(ROOT, 'artifacts/PaymentForwarder.json'), 'utf8'));
const tokenArtifact = JSON.parse(await readFile(resolve(ROOT, 'artifacts/MockERC20.json'), 'utf8'));
const chain = ganache.provider({
  chain: { chainId: 31337, networkId: 31337, hardfork: 'shanghai' },
  database: { dbPath: resolve(DATA, 'chain') },
  wallet: { mnemonic: DEV_MNEMONIC, totalAccounts: 6, defaultBalance: 1000 },
  miner: { blockGasLimit: 30_000_000 },
  logging: { quiet: true },
});
// The RPC endpoint is also loopback-only and checks Host/Origin to reject DNS rebinding.
const rpcServer = createServer(async (req, res) => {
  if (![`127.0.0.1:${RPC_PORT}`, `localhost:${RPC_PORT}`].includes(req.headers.host)
      || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (req.headers.origin) { res.setHeader('access-control-allow-origin', req.headers.origin); res.setHeader('vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('Use JSON-RPC POST'); }
  try {
    let body = '';
    for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 262144) throw new Error('Request too large'); }
    const parsed = JSON.parse(body);
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    if (requests.length > 100) throw new Error('Too many RPC requests');
    const results = await Promise.all(requests.map(async request => {
      try {
        if (!request || typeof request.method !== 'string' || !Array.isArray(request.params || [])) throw new Error('Invalid JSON-RPC request');
        const result = await chain.request({ method: request.method, params: request.params || [] });
        return { jsonrpc: '2.0', id: request.id ?? null, result };
      } catch (error) { return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: Number.isInteger(error.code) ? error.code : -32603, message: error.message || 'RPC operation failed', ...(error.data !== undefined ? { data: error.data } : {}) } }; }
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(Array.isArray(parsed) ? results : results[0]));
  } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC body' } })); }
});
rpcServer.requestTimeout = 30000;
rpcServer.headersTimeout = 15000;
await new Promise((resolve, reject) => { rpcServer.once('error', reject); rpcServer.listen(RPC_PORT, '127.0.0.1', resolve); });
const provider = new JsonRpcProvider(RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1 });
const [admin, merchantSigner, payer, executor] = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
const [adminAddress, merchantAddress, payerAddress, executorAddress] = await Promise.all([admin, merchantSigner, payer, executor].map(s => s.getAddress()));
const genesis = (await provider.getBlock(0)).hash;
const artifactHash = keccak256(factoryArtifact.bytecode + tokenArtifact.bytecode.slice(2));
let manifest;
try { manifest = JSON.parse(await readFile(resolve(DATA, 'deployment.json'), 'utf8')); } catch { /* First run. */ }
if (!manifest || manifest.artifactHash !== artifactHash || manifest.genesis !== genesis || manifest.admin !== adminAddress || await provider.getCode(manifest.factory) === '0x' || await provider.getCode(manifest.token) === '0x') {
  const factory = await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, admin).deploy();
  await factory.waitForDeployment();
  const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, admin).deploy('Test USD Coin', 'USDC', 6);
  await token.waitForDeployment();
  await (await token.mint(payerAddress, parseUnits('1000000', 6))).wait();
  manifest = { chainId: 31337, genesis, artifactHash, admin: adminAddress, factory: await factory.getAddress(), token: await token.getAddress(), deployedAt: new Date().toISOString() };
  await writeFile(resolve(DATA, 'deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const factory = new Contract(manifest.factory, factoryArtifact.abi, provider);
const token = new Contract(manifest.token, tokenArtifact.abi, provider);
const db = new DatabaseSync(resolve(DATA, 'lab.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, factory TEXT NOT NULL, order_json TEXT NOT NULL,
  address TEXT NOT NULL, label TEXT NOT NULL, asset TEXT NOT NULL,
  created_at TEXT NOT NULL, tx_hashes TEXT NOT NULL DEFAULT '{}'
);`);
const findOrder = db.prepare('SELECT * FROM orders WHERE id = ? AND factory = ?');
const listOrders = db.prepare('SELECT * FROM orders WHERE factory = ? ORDER BY created_at DESC');
const insertOrder = db.prepare('INSERT INTO orders (id,factory,order_json,address,label,asset,created_at) VALUES (?,?,?,?,?,?,?)');
const saveHashes = db.prepare('UPDATE orders SET tx_hashes = ? WHERE id = ? AND factory = ?');
let writeQueue = Promise.resolve();
let closing = false;
const serialized = task => { const result = writeQueue.then(task); writeQueue = result.catch(() => {}); return result; };
class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const decimalsFor = asset => asset === 'USDC' ? 6 : 18;
function amountInput(value, decimals, field = 'amount', allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new ApiError(`${field} must be a decimal amount.`);
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,35})(?:\.\d+)?$/.test(text)) throw new ApiError(`${field} must be a positive decimal amount.`);
  let parsed;
  try { parsed = parseUnits(text, decimals); } catch { throw new ApiError(`${field} supports at most ${decimals} decimal places.`); }
  if (parsed < 0n || (!allowZero && parsed === 0n)) throw new ApiError(`${field} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`);
  return parsed;
}
async function getRecord(row) {
  const order = JSON.parse(row.order_json);
  const [balance, code] = await Promise.all([factory.balanceOf(order), provider.getCode(row.address)]);
  const deployed = code !== '0x';
  const settled = deployed && await new Contract(row.address, forwarderArtifact.abi, provider).settled();
  const decimals = decimalsFor(row.asset);
  const txHashes = JSON.parse(row.tx_hashes);
  const transactions = [
    ...(txHashes.announcement ? [{ step: 'announced', hash: txHashes.announcement }] : []),
    ...(txHashes.payments || (txHashes.payment ? [txHashes.payment] : [])).map(hash => ({ step: 'deposit', hash })),
    ...(txHashes.settlements || (txHashes.settlement ? [txHashes.settlement] : [])).map((hash, i) => ({ step: i === 0 ? 'settled' : 'late_sweep', hash })),
  ];
  const timeline = await Promise.all(transactions.map(async tx => {
    const receipt = await provider.getTransactionReceipt(tx.hash);
    return { ...tx, status: receipt ? receipt.status === 1 ? 'confirmed' : 'failed' : 'pending', blockNumber: receipt?.blockNumber ?? null };
  }));
  return {
    order, address: row.address, label: row.label, asset: row.asset, createdAt: row.created_at,
    status: settled ? 'settled' : balance >= BigInt(order.amount) ? 'ready' : balance > 0n ? 'partial' : 'awaiting',
    balance: balance.toString(), balanceFormatted: formatUnits(balance, decimals),
    amountFormatted: formatUnits(order.amount, decimals), feeFormatted: formatUnits(order.executorFee, decimals),
    merchantPayoutFormatted: formatUnits(BigInt(order.amount) - BigInt(order.executorFee), decimals),
    deployed, settled, txHashes, timeline,
  };
}
function lookup(id) {
  const row = findOrder.get(id, manifest.factory);
  if (!row) throw new ApiError('Order not found.', 404);
  return row;
}
async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ApiError('Use application/json.', 415);
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 16_384) throw new ApiError('Request is too large.', 413);
  }
  let value;
  try { value = JSON.parse(body || '{}'); } catch { throw new ApiError('Invalid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ApiError('Expected a JSON object.');
  return value;
}
function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
const server = createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${API_PORT}`, `localhost:${API_PORT}`].includes(req.headers.host)) throw new ApiError('Unrecognized local Host header.', 403);
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw new ApiError('Origin is not allowed.', 403);
    if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      if (!origin) throw new ApiError('Origin is required.', 403);
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
      return res.end();
    }
    const path = new URL(req.url, `http://127.0.0.1:${API_PORT}`).pathname;
    if (req.method === 'GET' && path === '/api/config') return reply(res, 200, {
      chainId: 31337, rpcUrl: RPC_URL, factory: manifest.factory, token: manifest.token,
      merchant: merchantAddress, payer: payerAddress, executor: executorAddress,
      mode: 'local', warning: 'Public deterministic test wallets. Never send real funds.',
      factoryAbi: factoryArtifact.abi, tokenAbi: tokenArtifact.abi, forwarderAbi: forwarderArtifact.abi,
    });
    if (req.method === 'GET' && path === '/api/orders') return reply(res, 200, await Promise.all(listOrders.all(manifest.factory).map(getRecord)));
    if (req.method === 'GET' && /^\/api\/orders\/0x[a-fA-F0-9]{64}$/.test(path)) return reply(res, 200, await getRecord(lookup(path.split('/')[3])));
    if (req.method !== 'POST') throw new ApiError('Not found.', 404);
    if (!origin) throw new ApiError('A permitted local Origin header is required for mutations.', 403);
    const body = await jsonBody(req);
    const result = await serialized(async () => {
      if (path === '/api/orders') {
        const asset = body.asset;
        if (asset !== 'ETH' && asset !== 'USDC') throw new ApiError('asset must be ETH or USDC.');
        const decimals = decimalsFor(asset);
        const amount = amountInput(body.amount, decimals);
        const executorFee = amountInput(body.executorFee, decimals, 'executorFee', true);
        if (executorFee >= amount) throw new ApiError('The executor fee must be less than the total payment.');
        let merchant;
        try { merchant = getAddress(body.merchant || merchantAddress); } catch { throw new ApiError('Invalid merchant address.'); }
        if (merchant === ZeroAddress || merchant === manifest.factory || merchant === await factory.implementation()) throw new ApiError('Choose a valid merchant recipient.');
        const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
        const order = { id: hexlify(randomBytes(32)), merchant, token: asset === 'ETH' ? ZeroAddress : manifest.token, amount: amount.toString(), executorFee: executorFee.toString() };
        const address = await factory.predictAddress(order);
        let announcement;
        if (body.publish !== false) {
          const accounts = await provider.listAccounts();
          const signer = accounts.find(account => account.address.toLowerCase() === merchant.toLowerCase());
          if (!signer) throw new ApiError('On-chain publication needs the merchant signature. Use a local test account or turn off publication.');
          announcement = await factory.connect(signer).announce(order);
          await announcement.wait();
        }
        insertOrder.run(order.id, manifest.factory, JSON.stringify(order), address, label || 'Untitled payment', asset, new Date().toISOString());
        if (announcement) saveHashes.run(JSON.stringify({announcement: announcement.hash}), order.id, manifest.factory);
        return getRecord(lookup(order.id));
      }
      const match = path.match(/^\/api\/orders\/(0x[a-fA-F0-9]{64})\/(pay|settle)$/);
      if (!match) throw new ApiError('Not found.', 404);
      const row = lookup(match[1]);
      const record = await getRecord(row);
      const hashes = JSON.parse(row.tx_hashes);
      let transaction;
      if (match[2] === 'pay') {
        const value = body.amount == null ? BigInt(record.order.amount) : amountInput(body.amount, decimalsFor(record.asset));
        transaction = record.asset === 'ETH'
          ? await payer.sendTransaction({ to: row.address, value })
          : await token.connect(payer).transfer(row.address, value);
        hashes.payment = transaction.hash;
        hashes.payments = [...(hashes.payments || []), transaction.hash];
      } else {
        if (!record.settled && BigInt(record.balance) < BigInt(record.order.amount)) throw new ApiError('Payment is not fully funded yet.');
        if (record.settled && BigInt(record.balance) === 0n) throw new ApiError('Already settled; no late funds to sweep.');
        transaction = await factory.connect(executor).settle(record.order);
        hashes.settlement = transaction.hash;
        hashes.settlements = [...(hashes.settlements || []), transaction.hash];
      }
      const receipt = await transaction.wait();
      if (receipt.status !== 1) throw new ApiError('The transaction reverted.', 409);
      saveHashes.run(JSON.stringify(hashes), row.id, manifest.factory);
      return getRecord(lookup(row.id));
    });
    reply(res, path === '/api/orders' ? 201 : 200, result);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : 'Local chain operation failed. Check your test balance and retry.';
    if (!(error instanceof ApiError)) console.error('[lab]', error.code || error.name, error.shortMessage || error.message);
    if (!res.headersSent) reply(res, status, { error: message });
    else res.end();
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.on('error', async error => { console.error(`[lab] Cannot bind API: ${error.code || error.message}`); await shutdown(1); });
server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`Local test lab: http://127.0.0.1:${API_PORT} | RPC: ${RPC_URL} | chain 31337`);
  console.log(`Factory: ${manifest.factory} | USDC test token: ${manifest.token}`);
  console.log('DEV ONLY: all accounts use the public test mnemonic; balances have no value.');
});
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  server.close();
  await writeQueue;
  db.close();
  provider.destroy();
  rpcServer.close();
  await chain.disconnect();
  process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
