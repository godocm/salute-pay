# Salute — non-custodial payment protocol lab

A runnable Ethereum prototype with CREATE2 deposit addresses, a TVM-specific TRON local port, and a local Solana program with unique PDA vaults. All route funds to a fixed merchant and, if configured, an executor. The portal and observers hold no deposit keys. The EVM and TRON payment contracts have no owner or upgrade authority; the local Solana program retains a development upgrade authority until an immutable public release.

**Use local/testnet assets only. These prototypes have automated tests but have not received an independent security audit.** TRON and Solana have local tests, not public-network validation. See the [architecture and diagrams](docs/ARCHITECTURE.md), [Solana local runbook](solana/README.md), and [TRON local runbook](tron/README.md).

## Run locally

Requires Node.js 22.13+ and npm. From this directory:

```sh
npm install
npm --prefix portal install
npm run dev
```

Copy [`.env.example`](.env.example) to an ignored `.env` for your network IDs, RPC endpoints, token addresses, and later hosted services. The local EVM lab needs none of them. The Solana and TRON runbooks use loopback defaults; export variables from `.env` in your shell when overriding those defaults. Never place merchant, customer, or deposit keys in the hosted portal.

Open **http://localhost:5173/**. `npm run dev` compiles the contracts, starts a persistent local EVM on `127.0.0.1:8545`, starts the lab API on `127.0.0.1:8787`, deploys the factory and mock USDC when needed, and starts the portal. Ports must be free. Ctrl-C stops the two child services.

1. Create an ETH or mock-USDC payment. Leave **Publish order on-chain** enabled to make the terms independently discoverable. A merchant announcement transaction is sent, but **the deposit contract remains undeployed**.
2. Send a test payment from the customer account. You can send less than the total to test partial funding, then top it up.
3. Click **Execute settlement**. A separate executor account pays gas, deploys the clone, receives the reward, and routes the balance to the merchant in one transaction.
4. Inspect the contract status and transaction hashes. Send an extra payment to test **Sweep late funds**, which forwards all late funds to the merchant without another reward.
5. Export the order JSON. The executor CLI can use this file or discover announced orders from factory logs without the portal/database.

The local lab uses public deterministic development accounts with valueless ETH and a freely mintable mock token. Never fund those addresses on a public network. The lab binds to loopback and validates browser Origin and Host headers; it is not a remotely deployable custody API.

Local state lives in `.data/chain`, `.data/lab.sqlite`, and `.data/deployment.json`. Restarting preserves it. A changed contract artifact causes a new factory deployment and a new active order list; old records remain scoped to their original factory. Only back up or delete `.data` with the lab stopped. The root `.gitignore` excludes it.

## Contract flow

```text
Merchant announces terms (optional transaction, no deposit contract)
              ↓
Factory.predictAddress(order) → counterfactual deposit address
              ↓
Customer transfers ETH or exact ERC-20 to the address
              ↓
Any executor calls Factory.settle(order)
              ↓
CREATE2 clone + merchant payout + executor reward, atomically
```

`Order` is `(bytes32 id, address merchant, address token, uint256 amount, uint256 executorFee)`. `address(0)` means ETH. Amounts are base units; `amount` includes the executor reward. All economic terms and chain ID bind the address. Factory and implementation identity are also part of the CREATE2 derivation. Changing any term creates a different address and cannot redirect existing funds.

Example: for a 25 USDC order with a 0.25 USDC reward, settlement requires 25 USDC, sends 24.75 to the merchant and 0.25 to the executor. If 26 arrives, the merchant gets 25.75. The executor pays native gas up front even when its reward is a token.

- `announce(order)`: optional merchant-only call emits every term and the predicted address. Logs provide public availability and authenticate that the merchant address called the factory. Repeated announcements are harmless and should be deduplicated by deposit address. This is not a legal identity check.
- `predictAddress(order)`: read-only, no creation transaction.
- `balanceOf(order)`: current balance of the configured asset.
- `settle(order)`: anyone can call; deploys only when fully funded. A payout failure rolls back creation and all transfers.
- Clone `getOrder()`: reads immutable terms from deployed runtime code.
- Clone `settled()`: true for canonical deployed clones. Deployment and initial payment are atomic, so clone existence replaces a redundant per-order storage flag. No other factory method creates a clone.

Each persistent clone is **181 bytes**, including **136 bytes** of packed immutable order data. The implementation is shared, has an immutable factory caller, and cannot be upgraded. The factory has a global reentrancy guard. SafeERC20 handles conventional token returns. Merchant self-execution combines the two payouts into one transfer. No selfdestruct or redeployment trick is used.

### What “decentralized” means here

Custody and settlement are enforced on-chain. A funded executor can settle without our server or permission, and default announcements let an independent indexer reconstruct orders. Turning publication off saves gas but shifts order-data availability to the merchant: distribute and retain the exported JSON. An address alone is not enough to recover the order terms.

The portal, local lab API, SQLite index, and chosen RPC provider are convenience infrastructure. A production frontend should be independently hostable and use redundant RPC/indexing infrastructure, finality/reorg-aware event processing, and durable public order distribution. Token issuers may freeze or alter their assets independently of this protocol. Announced terms are public; never put customer personal data in order IDs or calldata.

## Test and build

```sh
npm test
node scripts/smoke-lab.mjs       # with local lab running
npm run build
```

18 contract tests cover prediction, immutable term/chain binding, merchant-authenticated announcements, partial funding, ETH/ERC-20 surplus splits, zero reward, merchant self-execution, late deposits, one-time reward semantics, direct-call restrictions, same-order and cross-order reentrancy, malicious-token callbacks, failed payouts, and false/no-return token compatibility. HTTP smoke checks exercise ETH and mock USDC, SQLite records, direct recipient balance changes, late sweeps, and origin restrictions.

Compiler: Solidity 0.8.30, optimizer 200 runs, via IR, Shanghai target. OpenZeppelin Contracts is pinned at 5.4.0. `npm test` regenerates `artifacts/gas-report.json`; `npm run compile` produces deployable ABI/bytecode artifacts.

Measured local gas, not live fee quotes:

- One-time factory + implementation: **914,314**.
- Optional order announcement: **28,437**.
- ETH deposit: **21,000**; deploy-and-settle: **124,371**.
- Mock ERC-20 deposit: **51,226**; deploy-and-settle: **163,020**.
- ETH late sweep: **47,256**; token late sweep: **49,571**.

Actual gas varies with calldata, recipients, token implementation, balances, and chain rules. Customer deposit gas and announcement gas are separate from settlement. At an illustrative 1 gwei, ETH settlement alone costs 0.000124371 ETH; multiply by 10 at 10 gwei. Default UI rewards demonstrate the split, **not a profitable live gas quote**. EVM rollup data fees require separate estimates. A direct router can be cheaper if the payer can call a contract with an order ID; the unique plain-transfer address experience carries a deployment cost.

## Deploy to an Ethereum testnet

Use a dedicated funded testnet deployer. Do not paste keys into the portal or commit them. Provide secrets through your shell/session environment. The CLI does not broadcast unless requested:

```sh
# Set RPC_URL, PRIVATE_KEY, and EXPECTED_CHAIN_ID in your environment.
# Example chain ID for Sepolia: 11155111.
npm run deploy                 # compile + estimate only
npm run deploy -- --broadcast  # deploy factory + immutable implementation
```

Deployment metadata is written under `deployments/`. In the portal's **Connection** tab, enter the chain ID, resulting factory address, and optionally the address of a tested standard ERC-20. Connect your wallet on that chain. The connected merchant signs announcements; a customer/executor can import the same order JSON and use a different wallet.

Wallet-mode metadata stays in that browser, scoped by chain and factory. Export orders, or reconstruct them from announcement logs. The private hosted portal is a wallet client; it does not host your local EVM, hold keys, or contain a pre-funded public-testnet factory. No public-chain deployment is performed automatically.

## Run an independent executor

Set `RPC_URL` and `FACTORY_ADDRESS`. Optionally set `EXPECTED_CHAIN_ID`; use a deployment block near the first announcement. No gateway API or database is needed:

```sh
npm run executor -- --from-block 0                  # discover logs; dry-run
npm run executor -- --orders /absolute/order.json   # singleton or array; dry-run
```

For execution, set `EXECUTOR_PRIVATE_KEY` for your funded executor and add `--execute`. For ERC-20 rewards, review token economics and explicitly add `--allow-token-fees`. These flags do not make arbitrary tokens safe.

```sh
npm run executor -- --from-block 0 --execute
npm run executor -- --orders /absolute/order.json --execute --allow-token-fees
```

The command scans once and exits. Re-run it or operate your own service for continuous execution. Log discovery is bounded to 100,000 blocks and chunks 2,000 blocks per query; use an RPC-appropriate range or an indexed JSON feed for larger history. It deduplicates discovered announcements, checks imported network/factory/address metadata, estimates gas with a 20% limit buffer, and checks ETH reward against the quoted maximum gas budget. Fee caps are carried into the transaction. Token rewards require independent pricing. Late sweeps have no bounty and are reported rather than automatically executed. A competing executor can still win the race and cause a failed transaction cost; there is no guaranteed executor profitability or availability.

## Boundaries to test before production

- Underpayments have no cancellation or payer refund path. They remain until topped up. Plain token/ETH deposits do not reliably identify an intended refund recipient; this needs an explicit product design.
- Wrong tokens, wrong chains, and unexpected assets have no recovery path. Only the configured asset can be swept.
- Fee-on-transfer, rebasing, reflection, and arbitrary tokens are unsupported. SafeERC20 success does not prove a net recipient balance increase. Test and restrict supported assets at the product boundary.
- Merchants must accept the configured asset. A contract rejecting ETH, or issuer blacklisting/freezing, can block settlement; funds remain at the deposit address.
- Never reuse order IDs as business identifiers across changed terms without tracking the full deposit address. Labels are untrusted display metadata; verify the merchant, chain, asset, and factory before funding an invoice.
- The lab uses immediate confirmations. Production fulfillment needs a finality policy and reorg handling. The included executor is a transparent starting point, not a competitive MEV or pricing system.
- Obtain an independent audit, invariant/fuzz testing, exact-token integration tests, and testnet validation before real funds.

See [docs/CHAINS.md](docs/CHAINS.md) for TRON and Solana research, native/token prefunding differences, resource costs, and primary sources. The [Solana runbook](solana/README.md) and [TRON runbook](tron/README.md) cover local tests, read-only observers, and portal pages.

The September 24 architecture decision and fair HD-wallet comparison are in [docs/PAYMENT-ECONOMICS.md](docs/PAYMENT-ECONOMICS.md). It includes the proposed off-chain intent/reward policy, current TRON resource observations and Solana storage costs. Reproduce the isolated Ethereum comparison with `node scripts/benchmark-economics.mjs`. These research additions do not change the current fixed-fee contracts.
