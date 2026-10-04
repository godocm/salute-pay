# Executor fees and signed payment intents

Research checked 24 September 2026. This is a proposed next-version design, not implemented contract behavior. The deployed prototype uses a fixed `executorFee` that is part of the CREATE2 address commitment.

## Recommendation

Use **competitive offchain fee quotations with onchain enforcement of merchant-authorized terms**. Quote the complete deployment-and-settlement cost in the payment token, add a small execution margin, and cap the reward. This is especially appropriate for TRON, where two executors can spend the same Energy but acquire it at different economic costs. A contract can enforce a price and pay it automatically; it cannot know every executor's true economic cost or guarantee that someone will execute.

The product is a **noncustodial payment settlement protocol with permissionless executors**. Without token swaps, it is not a DEX. The company can provide a dashboard, indexer, and order relay, but “completely decentralized” additionally requires independent access to the signed order data, independent execution, and no privileged key that can redirect or freeze payments. Permissionless contracts alone do not make a sole hosted order server independently available.

For the two-transaction address-only flow, creation of an offchain intent is free of network fees. Transaction 1 transfers funds to the predicted address. Transaction 2 calls the factory, deploys the forwarder, and transfers the merchant proceeds and executor reward atomically. The two outgoing transfers are internal operations in transaction 2, not two additional top-level transactions. A prior onchain order announcement is optional and adds a third transaction. Gas/Energy used by internal operations still counts.

## What the existing code does

`contracts/PaymentFactory.sol` hashes every economic term, including the fixed `executorFee`, into the address. `contracts/PaymentForwarder.sol` pays that fixed reward only on initial settlement and sends the remaining balance to the merchant. Subsequent funded calls sweep late deposits without another reward. Changing the current fee produces a different address; it does not reprice funds already sent to the original address.

The current contracts do not implement EIP-712 merchant signatures, fee auctions, fee oracles, automatic gas reimbursement, expiry recovery, or a TRON/Solana deployment. The optional `announce()` authenticates the merchant through `msg.sender`. Without announcement, the current address commitment fixes the supplied terms but does not prove the merchant authenticated the order offchain.

## Proposed quote and cap policy

Gas and Energy depend mostly on the code path and account/token state, not the numerical size of a normal transfer. Paying a percentage of a large deposit therefore overpays an executor, while the same percentage can underpay for a small deposit. Use the deposit amount for a fee cap and minimum viable order check, not as the primary cost estimator.

Define all token values in integer smallest units:

```text
D       = agreed total deposit
Mmin    = minimum merchant proceeds
C       = freshly simulated execution cost before margin, in deposit-token units
m       = modest margin in basis points, chosen through executor competition
Rtarget = ceil(C × (10_000 + m) / 10_000)
Rcap    = min(absoluteFeeCap, floor(D × maxFeeBps / 10_000), D − Mmin)
```

Accept only a nonnegative `Rtarget <= Rcap`. An executor's all-in reward quote may already contain its margin; compare it directly to the cap rather than adding margin twice. If cost exceeds the cap, report the order as uneconomic and obtain a new accepted quote, arrange a top-up under the agreed policy, or use merchant self-settlement. Silently clamping the reward does not make an unprofitable transaction attractive to an executor. Give rounding and token decimals explicit treatment with full-precision arithmetic.

For illustration only, a 1.00 USDT estimated cost and a 5% margin produce a 1.05 USDT reward, independent of whether the deposit is 100 or 1,000 USDT. If the merchant permits at most 0.50 USDT, that quote is not viable. A 5% margin is an initial pricing experiment, not a guarantee that executors will accept it: failed-race risk, liquidity, and operating costs matter too.

Get quotes from multiple executors or independent estimators. Merchant acceptance of the best acceptable quote is an offchain signature. Execution checks that signature and its cap, so the dashboard is not a privileged fee setter. A short quote validity period, for example 60–120 seconds as a configurable initial policy, limits stale-price exposure. The executor must re-simulate immediately before submission. A signed fixed token reward removes the need for a token/native exchange-rate oracle during settlement; the quoting side bears conversion and price risk. An onchain price oracle instead adds its own freshness, manipulation, availability, and operating-cost requirements.

## Intent and quote separation

For a future contract version, predict the address from a stable **base intent** rather than a short-lived execution quote. Bind the chain/network domain, factory/version, unique order identifier, merchant, asset, total deposit, minimum merchant output, maximum reward, and explicit recovery terms. Exclude the executor identity, actual accepted reward, and ephemeral quote expiry from the address commitment. The maximum reward is still committed; removing all fee constraints would be unsafe.

A separate merchant-signed execution authorization binds the base-intent hash, selected reward, validity period, and quote nonce. Keep it usable by any executor; bind payment to the authenticated caller or explicitly authorized reward recipient. Use a one-time settlement flag or another rigorously verified once-only invariant. Any retry after settlement must not pay a second initial reward. Authentication, deployment, and both payouts must be atomic and guarded against reentrancy.

This allows a new quote within the original fee cap without changing the prefunded address. It requires a new factory/forwarder design and fresh tests; the existing fixed-fee factory cannot be modified in place. A short-lived signature should never be the only permanent authority capable of moving funds at an address to which someone can send tokens years later.

Include an **indefinite recovery path** in the original immutable terms: merchant self-settlement with zero executor reward, plus a specified treatment of expired quotes, late deposits, underpayments, unsupported assets, and refunds. A refund address must be explicitly agreed; token transfers do not reliably identify one payer when an exchange, intermediary, or multiple payers send funds. Avoid allowing intent expiry or cancellation to make prefunded funds permanently unspendable. A recovery route and any ability to alter fee caps must preserve the payer's agreed minimum output and destination guarantees.

Anyone who needs to execute must be able to obtain the complete base intent and valid authorization independently of the company's live server. Provide signed order export, a documented open relay interface, and multiple independent mirrors. Onchain publication is an optional stronger availability mechanism with an additional fee.

## Can the contract calculate reimbursement itself?

### Ethereum native ETH: bounded approximation is possible

Solidity exposes `gasleft()`, `tx.gasprice`, and `block.basefee`. Under EIP-1559, `tx.gasprice` is the **effective** gas price paid, not the sender's maximum fee limit. The effective price includes base fee and priority fee. [Solidity variables](https://docs.soliditylang.org/en/latest/units-and-global-variables.html), [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559).

An optional advanced policy could calculate:

```text
G = min(measuredProtocolGas + calibratedOverhead, signedGasUnitCap)
P = min(tx.gasprice, block.basefee + signedTipCap, signedGasPriceCap)
Cnative = G × P
Rnative = ceil(Cnative × (10_000 + marginBps) / 10_000)
require Rnative <= signedRewardCap and merchantProceeds >= signedMinimum
```

This is a budgeted reimbursement approximation, not an exact receipt. Measurement starts after some transaction work and ends before its own payout and final bookkeeping. The full intrinsic cost, calldata/access-list costs, possible wrapper or bundler work, refund effects, and chain-specific fee rules need separate treatment. Refunds apply after execution; calldata also has a transaction-level floor under EIP-7623. An L2 may charge an additional data fee. [EIP-3529](https://eips.ethereum.org/EIPS/eip-3529), [EIP-7623](https://eips.ethereum.org/EIPS/eip-7623).

Do not reimburse arbitrary caller-supplied gas figures or an uncapped priority fee. Executors control their bid and may control callbacks; multiplying reimbursed expenditure by a margin can reward deliberate waste. Bound permitted operations, gas units, tips, and the total payout. Calibrate only the protocol path, not arbitrary work that a wrapper transaction performs. Failed competing transactions receive no successful-settlement reward even though their senders can pay network fees.

For an ERC-20 reward the gas cost is in ETH while the reward is in token units. The contract needs an explicit validated conversion source to derive the latter; `gasleft()` alone cannot price USDT/USDC. For this simple payment use case, a competitive quoted token reward is usually cheaper and easier to reason about than measurement plus an oracle.

### TRON: use resource-aware quotations

TRON charges Bandwidth for transaction bytes and Energy for contract execution. Energy may be staked, delegated, or paid through the TRX-burn fallback, and contract Energy sharing can alter who bears the resources. Consequently, Energy consumption does not equal an executor's purchased-resource cost. [TRON resource model](https://developers.tron.network/docs/resource-model).

The executor should simulate the exact factory deployment and both token transfers, then quote its own resource acquisition cost plus margin in the payment token. Include current dynamic Energy effects, recipient/token state, Bandwidth, and the factory's resource-sharing settings. Treat actual transaction receipts as post-execution cost telemetry for later quotes. Avoid hardcoding one “USDT transfer costs X Energy” value or copying Ethereum gas measurements into a TRON estimate.

A protocol can publish a reference price for Energy and compute `estimatedEnergy × referencePrice + bandwidthCost` onchain, but that reimburses a policy-defined price. It cannot prove what a particular executor paid a rental provider or the opportunity cost of its stake. Competitive quotes handle that variation more directly. Buying/delegating resources for an executor can itself entail extra transactions, depending on the arrangement; report them separately from the two payment transactions.

### Solana: quote message fees and storage separately

A client can obtain a transaction fee with `getFeeForMessage`; for the usual legacy/v0 message model, priority fee depends on the requested compute-unit limit and price. Consequently “actual compute units consumed × bid” is not the general priority-fee rule. Follow the selected message format's fee rules; current documentation also describes an absolute priority-fee field for v1 messages. [Agave transaction-fee documentation](https://docs.anza.xyz/implemented-proposals/transaction-fees), [Solana fees](https://solana.com/docs/core/fees).

Use one program and order PDAs rather than deploying a program per deposit. Quote the entire intended message, any priority fee, required account creation funding, and a small margin. Account rent-exempt funding is recoverable capital when an eligible account is closed, not all an irrecoverable network fee. Assign its refund explicitly so an executor cannot claim reimbursement and also retain an unintended refund. A token-denominated quote avoids a SOL/token price oracle in the payout path. [Solana PDAs](https://solana.com/docs/core/pda), [Account storage](https://solana.com/docs/core/accounts), [Token-account closure](https://solana.com/docs/tokens/basics/close-account).

## Relevant production patterns

- **OpenZeppelin:** `Clones` offers deterministic immutable-argument clones and address prediction. Use pinned, chain-compatible library/compiler versions and verify the implementation has code. `EIP712` and `SignatureChecker` supply typed-data hashing and EOA/ERC-1271 signature validation; they do not supply fee economics or an intent protocol. [Clones](https://docs.openzeppelin.com/contracts/5.x/api/proxy#Clones), [Cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography). `SafeERC20` and reentrancy protection are already used by the prototype. Signature validation remains proposed work.
- **UniswapX:** signed output constraints and competing fillers are a useful analogy. Current integration documentation specifies RFQ plus exclusive Dutch auctions, with permissionless filling after exclusivity or through the specified override; quoters are permissioned. Its current docs say Priority gas auctions are no longer a separate integration path. This is not a universal exact-gas-refund mechanism, and copying a permissioned quoter gate would conflict with this project's desired open model. [Filler integration](https://developers.uniswap.org/docs/liquidity/uniswapx/filling/overview), [UniswapX overview](https://developers.uniswap.org/docs/liquidity/uniswapx/overview).
- **CoW Protocol:** the driver simulates settlements and combines compatible solutions into more efficient batches. Its production solver infrastructure has bonding/registration requirements, and documented accounting includes later network-fee reimbursements and rewards. It should not be represented as a completely unrestricted, per-transaction `gasleft()` reimbursement system. [Driver](https://docs.cow.fi/cow-protocol/tutorials/arbitrate/solver/driver), [Solver onboarding and accounting](https://docs.cow.fi/cow-protocol/tutorials/solvers/onboard).
- **Across:** relayer quotes distinguish gas, capital, and risk costs; the input/output spread pays the relevant actors. This supports quoting the complete cost before execution rather than tying fees only to deposit size. This project is same-chain and does not require Across's crosschain capital/LP machinery. [Across fees](https://docs.across.to/introduction/fees).

The shared lesson is **signed economic bounds, simulation, and competing execution**. None of these references makes exact cost-plus compensation available for free on every chain. The simplest appropriate design here is a fixed accepted reward per execution authorization, enforced against immutable merchant protections, with safe repricing and recovery designed before customers fund an address.
