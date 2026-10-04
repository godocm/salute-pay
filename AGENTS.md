# Salute project guidance

## Product and scope
- Build a non-custodial payment/settlement protocol; the company supplies an optional dashboard. Do not describe it as a DEX unless token exchange is implemented, or claim the entire service is decentralized solely because settlement is permissionless.
- Target flow: merchant creates/distributes an intent off-chain; customer funds its deterministic address; any executor deploys and settles atomically for a bounded reward. This is two on-chain transactions without order announcement, setup, or retries.
- Current implementation targets Ethereum/EVM. TRON and Solana documents are researched designs, not implemented or benchmarked ports.
- Do not add gateway custody keys, privileged payout changes, or upgrade/admin authority without an explicit product request.

## Repository and commands
- `contracts/`: Solidity 0.8.30; pinned OpenZeppelin 5.4.0; optimizer 200, via IR, Shanghai. `test/`: Node tests using isolated Ganache.
- `scripts/`: compilation, local lab, deployment and independent executor. `portal/`: React/Vinext dashboard with its own package, lockfile, Git repository and Sites hosting manifest.
- Install: `npm install` and `npm --prefix portal install`. Start all local services: `npm run dev`. Portal 5173; loopback RPC 8545; loopback API 8787.
- Contract checks: `npm test`. Integration: `node scripts/smoke-lab.mjs` with the lab running. Build: `npm run build`. Typecheck: `cd portal && npx tsc --noEmit`.
- `.data/` contains persistent chain/SQLite/deployment state. Preserve it across runs; never overwrite or delete it as routine setup. Contract changes produce a new local factory scope.
- Never commit secrets, real wallet keys, `.env`, dependency trees, or `.data`. Public development accounts and mock tokens are for local testing only.

## Contract invariants
- In the current fixed-fee version, bind every payout term, order ID, chain and factory to the predicted address. Funding must precede clone deployment; all initial payouts and deployment must revert together on failure.
- Merchant destination is immutable; amount includes executor reward; reward is paid once; surplus and late deposits go to the merchant.
- The 181-byte persistent clone stores terms in code. Canonical clone existence currently implies initial settlement completed; `settled()` relies on that invariant. Do not add independent deployment/recovery paths without revisiting it.
- Keep factory-only forwarder execution, global reentrancy protection, safe token transfers, and no selfdestruct. Prefer reviewed OpenZeppelin primitives over custom crypto/proxy assembly.
- `announce` is optional, merchant-authenticated public log data, not order storage. Enabling it adds a transaction. Current private order JSON is not an EIP-712 signed intent; do not claim signature validation exists.
- Current `executorFee` is fixed and part of CREATE2 derivation. Changing it changes the address. Dynamic fees require an explicit versioned design and new tests, not a silent mutation of existing orders.
- Maintain tests for term/chain binding, partial funding, surplus, late sweeps, fee bounds, failed transfers, direct calls, malicious callbacks and repeat execution. ABI changes require `node scripts/export-abi.mjs` and checking the portal's human-readable ABI.

## Fee design and claims
- Compare complete lifecycles: payer deposit, initialization/activation, gas funding/resource delegation, sweep, merchant settlement, executor profit and any refunds. Amortize batched withdrawals fairly.
- Distinguish transaction count from gas/Energy/compute cost. Internal transfers still consume resources. Do not equate Ethereum gas with TRON Energy.
- Prefer competitively quoted, merchant-authorized capped rewards and a minimum merchant receipt. Deposit percentage can limit fees but does not estimate computation cost.
- Never promise exact actual-cost reimbursement from `gasleft()`/`tx.gasprice`; account for missing overhead, executor-selected fee inputs, token conversion, resource subsidies/rentals and failed races.
- Label measured data, live network parameters, hypothetical arithmetic and unimplemented proposals separately; timestamp primary sources. Do not present a TRON/Solana cost estimate as a deployment benchmark.

## Known boundaries and infrastructure
- Prototype lacks refunds, partial-payment exits, wrong-asset recovery, signed private-intent authentication and dynamic fee calculation. Ordinary fixed-balance ERC-20s only; fee-on-transfer/rebasing assets are unsupported.
- The dashboard/database is a convenience index, not an authority over funds. Preserve independent execution via exported order data or public announcements; discuss data availability when disabling announcements.
- Keep local Host/Origin checks and loopback binding. Never expose the lab API as a production signing service.
- Preserve the portal's local/testnet distinction, chain/factory validation, and clear transaction status. Do not send public-chain transactions as part of routine tests.
- Follow `README.md` for operation; consult `docs/CHAINS.md` and the dated fee research for chain-specific design. Describe security testing accurately; it is not an independent audit.
