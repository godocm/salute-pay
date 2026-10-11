# Salute project guidance

## Product and scope
- Build a non-custodial payment/settlement protocol; the company supplies an optional dashboard. Do not describe it as a DEX unless token exchange is implemented, or claim the entire service is decentralized solely because settlement is permissionless.
- Target flow: merchant creates/distributes an intent off-chain; customer funds its deterministic address; any executor deploys and settles atomically for a bounded reward. EVM and native SOL can use two on-chain transactions without announcement; SPL needs token-account setup.
- Main implementations target Solana (Ed25519), EVM networks including Tempo (EIP-712) and TRON (TIP-712). Tempo and Solana are primary. Eight public testnets are deployed; use docs/DEPLOYMENT.md and deployments/ for verified addresses and evidence.
- Do not add gateway custody keys, privileged payout changes, or upgrade/admin authority without an explicit product request.

## Repository and commands
- `contracts/`: Solidity 0.8.30; pinned OpenZeppelin 5.4.0; optimizer 200, via IR, Shanghai. `test/`: Node tests using isolated Ganache.
- `scripts/`: compilation, local lab, deployment and independent executor. `portal/`: Next.js dashboard with its own package, lockfile, Git repository and Sites hosting manifest.
- Install: `npm install` and `npm --prefix portal install`. `npm run dev` starts the signed wallet frontend. Portal 5173 by default (use 5174 if occupied); use Node 24 LTS for the Next.js portal. Local chain tests use isolated loopback RPCs.
- Internal deployment guides stay in `docs/`, never `portal/public` or frontend links. `npm run deploy:testnets` parses ignored root `.env` using per-network keys/RPCs, preflights all selected chains and broadcasts only with `--broadcast`. Verified main addresses go to `portal/public/deployments/main.json`; preserve older deployment history; omit keys/private RPC URLs. Preserve incomplete checkpoints and never remint on reruns.
- Contract checks: `npm test`. Integration: `npm run test:platform` with the isolated local test database. Build: `npm run build`. Typecheck: `cd portal && npx tsc --noEmit`.
- `.data/` contains persistent chain/SQLite/deployment state. Preserve it across runs; never overwrite or delete it as routine setup. Contract changes produce a new local factory scope.
- Never commit secrets, real wallet keys, `.env`, dependency trees, or `.data`. Public development accounts and mock tokens are for local testing only.

## Contract invariants
- This repository now has one main implementation per execution environment. The user explicitly requested retirement of older versions and migration of the UI. Preserve historical funded order data and `.data`; do not silently translate old links to main addresses.
- Main EVM behavior is specified in `docs/ARCHITECTURE.md`. Fixed origin chain and original order terms are bound into immutable arguments and salt. Never use executing chain ID in receiver derivation. Address equality requires matching canonical factory/root/salt/bytecode/implementation; verify identities before execution.
- EIP-712 base authorization uses the signed origin chain and cryptographic domain version 4. Separate reward quotes bind actual execution chain, asset, fixed order digest, one-use merchant nonce, deadline and positive minimum receipt. Consume nonces atomically with payout. Foreign ERC-1271 is unsupported; portable authorization uses EOA signatures.
- Merchant destination is immutable. Invoice amount is an accounting expectation, not a collection minimum. Fixed origin/intended-asset rewards are per sweep. Wrong-asset/wrong-chain recovery defaults to sponsorship. Zero reward and merchant self-collection perform only the merchant transfer. Never infer invoice completion from receiver existence.
- Funding precedes EVM receiver deployment; deployment and all initial payouts revert together on failure. Keep factory-only execution, global reentrancy protection, safe transfers, exact token receipt checks and no selfdestruct/admin/payout setter/upgrade hooks.
- Tempo is transferable TIP-20-only with explicit funded fee-token preference. Policy redirection must revert. Dummy issuer/admin authority is test-token-only.
- Solana uses Ed25519 and merchant-bound PDAs. SOL can be prefunded before atomic registration/collection. SPL addresses require account setup and separately sponsored rent. Retain vault reserve for late deposits. Public deployment must revoke upgrade authority before activation. TRON uses its own TIP-712/TVM derivation and resource model.
- Maintain main tests for chain/term binding, partial/excess/late balances, per-sweep and zero rewards, failed transfers, callback reentrancy, replay protection and direct calls. ABI changes require export and portal human-readable ABI checks.

## Fee design and claims
- Compare complete lifecycles: payer deposit, initialization/activation, gas funding/resource delegation, sweep, merchant settlement, executor profit and any refunds. Amortize batched withdrawals fairly.
- Distinguish transaction count from gas/Energy/compute cost. Internal transfers still consume resources. Do not equate Ethereum gas with TRON Energy.
- Prefer competitively quoted, merchant-authorized capped rewards and a minimum merchant receipt. Deposit percentage can limit fees but does not estimate computation cost.
- Never promise exact actual-cost reimbursement from `gasleft()`/`tx.gasprice`; account for missing overhead, executor-selected fee inputs, token conversion, resource subsidies/rentals and failed races.
- Label measured data, live network parameters, hypothetical arithmetic and unimplemented proposals separately; timestamp primary sources. Do not present a TRON/Solana cost estimate as a deployment benchmark.

## Known boundaries and infrastructure
- No customer refunds, cancellation/expiry, bridging, exchange or exact-cost reward reimbursement. Standard fixed-balance transferable assets only; frozen, fee-on-transfer and rebasing tokens are unsupported.
- Next.js/Vercel portal and PostgreSQL publisher replace the old lab. `docs/DEPLOYMENT.md` is the operational guide. Network activation requires verified main deployment metadata; see the current verified public testnet registry.
- Wallet sessions authenticate origin-bound one-use challenges. Settings and merchant lists require ownership. Publication must lock quota checks atomically. Plan upgrades are operator-only; billing checkout is not implemented.
- Webhooks come from server-verified chain receipts and transactional outbox entries, never a browser claim. Keep HMAC/raw-body verification, stable event IDs, retries, HTTPS DNS/IP validation and pinned lookup, no redirects. External scheduling is required. Monitor bounded watcher backlogs and RPC errors.
- The dashboard/database is a convenience index, not fund authority. Preserve independent execution via exported signed order data and consider data availability. Secrets stay server-only; no production signing service or custody wallet.
- Keep loopback local tests and explicit public/testnet status. Routine tests never send public-chain transactions. Security testing is not an independent audit.
