# TRON local prototype

This is a TVM-specific CREATE2 payment receiver and factory. Orders are created off-chain; `predictAddress` binds chain, factory, merchant, token, amount, reward and ID to the deposit address. Customer funding precedes deployment. Any executor can deploy and settle atomically, with one merchant payout when reward is zero and two recipient payouts when nonzero. A persistent receiver sends surplus and late deposits only to the merchant.

The code uses pinned TRON Solidity 0.8.30 and OpenZeppelin TRON Contracts 5.6.0. Its `Create2` helper uses TVM's `0x41` hash domain. `SafeTRC20.safeTransferChecked` is used because TRON USDT may return `false` after a successful transfer. Only conventional fixed-balance TRC-20 assets are in scope; the test token is a mock, not USDT.

## Local TRE test

From the repository root:

```sh
npm install --prefix tron
docker pull tronbox/tre
docker run --rm --name salute-tron-tre -p 127.0.0.1:9090:9090 tronbox/tre
```

In another terminal, obtain a **local TRE test key** from the container's `Private Keys` section and set `PRIVATE_KEY_DEV` in your shell. Never use a real wallet key. Then:

```sh
cd tron
npx tronbox test --network development --compile-all
cd ..
npm run tron:observe
```

The test writes a local demo-order index under `.data/tron/`. The read-only observer at `127.0.0.1:8791` rechecks current balances and settlement state against TRE and returns transaction receipt steps. Open `http://localhost:5173/tron` in the portal. Neither observer nor portal holds a key.

Local tests cover native TRX prefunding, exact predicted address, zero/nonzero rewards, term binding, surplus, late sweeps, and mock TRC-20 settlement. **Public TRON is not validated.** Before displaying public payable addresses, test native account activation, undeployed TRC-20 withdrawals, the exact target token (including USDT semantics), TVM compiler/runtime compatibility, Energy and Bandwidth, and independent executor settlement on Shasta or Nile. This is not an audit.
