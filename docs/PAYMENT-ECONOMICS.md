# Final architecture and fee decision

Research date: **24 September 2026**. Ethereum figures below are local measurements of the existing prototype. TRON combines read-only Mainnet observations with explicitly hypothetical component arithmetic. Solana combines documented fee rules with live storage queries. No TRON/Solana gateway exists in this repository, and no public-network transactions were sent for this analysis.

## Decision

Describe Salute as **a non-custodial payment protocol with permissionless settlement and an optional company-operated dashboard**. A DEX exchanges assets; forwarding the same asset to a merchant and executor is payment settlement. Independent executors must be able to retrieve the complete intent without the company's server. Signed exports and independently operated relays can do that off-chain; a sole private database cannot. The current optional announcement publishes terms on-chain at an extra transaction cost.

The requested flow is feasible. It is primarily a custody and interoperability improvement, **not a general network-fee reduction**. Per-order CREATE2 is more expensive than the measured HD baselines on Ethereum and likely more resource-intensive than optimized HD sweeping on TRON. Solana is attractive for low absolute fees because it reuses one program, but it still needs token-account funding, replay protection, and executor compensation.

The company dashboard need not be an authority over funds. The current local lab API signs only valueless development transactions and must not be confused with the intended production architecture. Public execution, immutable destinations, no company-controlled settlement gate, and independent intent availability are the production requirements.

## Transaction count

For Ethereum/TRON, with an off-chain intent and plain compatible asset transfers:

1. Customer sends the deposit to the predicted address.
2. Executor calls the factory: deployment, merchant transfer and reward transfer execute atomically inside that transaction.

**Two top-level transactions.** The internal transfers are not free. Factory deployment is a one-time setup transaction. The existing enabled-by-default order announcement makes the current portal flow three transactions; disable it for the pure off-chain flow and provide reliable intent distribution. Partial top-ups, late sweeps, resource provisioning and retries add transactions when used.

Your existing HD flow has customer deposit, sweep to cold wallet, and later merchant payout: usually three transfer transactions, with token gas funding/account activation/resource delegation potentially adding more. When one withdrawal covers N orders, divide its cost by N. Direct HD-to-merchant sweeping can already be two transfers. HD address derivation itself is off-chain and free; there is no Ethereum contract-deployment cost to match against CREATE2.

On Solana, two transactions are feasible if token ATA creation is included in the deposit transaction. Plain exchange withdrawals can require a separate ATA preparation transaction. Do not deploy a Solana program per order.

## Ethereum: measured lifecycle comparison

Run `node scripts/benchmark-economics.mjs` to reproduce the isolated benchmark. Full receipts and assumptions are in [ethereum-cost-benchmark.json](ethereum-cost-benchmark.json).

- ETH, CREATE2: **145,371 gas** across 2 transactions, including **124,371 gas** for the executor.
- ETH, HD → treasury → merchant: **63,000 gas** across 3 transactions.
- ETH, HD → merchant directly: **42,000 gas** across 2 transactions.
- Mock ERC-20, CREATE2: **214,246 gas** across 2 transactions, including **163,020 gas** for the executor.
- Mock ERC-20, HD + gas top-up → treasury → merchant: **152,778 gas** across 4 transactions.
- Mock ERC-20, HD + gas top-up → merchant directly: **118,652 gas** across 3 transactions.

This is approximately 2.31× the native-ETH treasury lifecycle and 1.40× the mock-token treasury lifecycle, despite fewer transactions. At an illustrative 1 gwei, the CREATE2 totals cost 0.000145371 ETH and 0.000214246 ETH respectively. These are not live fee quotes. At 10 gwei, multiply them by ten. Optional announcement adds approximately 28,437 gas. Future signature/dynamic-fee logic adds work not included here.

The benchmark uses Shanghai, native EOA recipients, pinned OpenZeppelin MockERC20, fresh merchant/executor token balances and an established treasury. It is not a mainnet USDC/USDT benchmark. Setup, reward margin and HD dust are excluded. ETH supplied in a gas top-up is not all consumed: count the top-up transaction fee separately from transferred funding. A funded HD address avoids that top-up transaction. [Ethereum fee model](https://ethereum.org/developers/docs/gas/)

## TRON: the main cost issue

The live Mainnet price was **100 sun per Energy**, so 10,000 uncovered Energy costs 1 TRX when burned. Bandwidth price was 1,000 sun/byte. The same computation can instead consume staked/delegated Energy with a different economic cost. [Live chain parameters](https://api.trongrid.io/wallet/getchainparameters), [resource model](https://developers.tron.network/docs/resource-model)

Read-only USDT transfer simulations, checked against recent receipts, observed:

- **64,285 Energy** to a recipient with nonzero USDT: **6.4285 TRX** Energy burn equivalent.
- **130,285 Energy** to a recipient with zero USDT: **13.0285 TRX** Energy burn equivalent.

These refer to particular calls on September 24, not fixed token fees. The token's dynamic Energy factor and recipient state matter. An address being activated is different from having a nonzero USDT storage balance.

TVM CREATE2 has a 32,000-Energy base; storing contract code costs 200 Energy/byte in the checked implementation. A hypothetical port retaining the 181-byte receiver therefore spends **68,200 Energy** on those components alone. [TVM opcodes](https://developers.tron.network/docs/opcodes), [released code-storage tariff](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/EnergyCost.java#L60)

An **illustrative component model**, not a gateway benchmark:

- Executor with two existing USDT recipients: `68,200 + 64,285 + 64,285 = 196,770 Energy`, equivalent to **19.677 TRX**, before other modeled work and Bandwidth.
- Executor with both recipients initially at zero USDT: **328,770 Energy**, equivalent to **32.877 TRX**, with the same caveat.
- Customer's initial deposit to a new zero-USDT address separately uses the **130,285 Energy** reference.
- Using the first executor scenario gives a lifecycle subtotal of **327,055 Energy / 32.7055 TRX**.
- Three plain HD transfers with an existing cold wallet and merchant give **258,855 Energy / 25.8855 TRX**, before their activation/provisioning/Bandwidth costs. Batched merchant withdrawals reduce this baseline further.

**Those summed figures are neither exact estimates nor rigorous lower bounds.** Standalone and internal-call paths differ, draining balances can change work, a TVM port can have different bytecode, and dynamic penalties can change. Exact executor Energy requires compiling the actual TRON implementation and simulating its complete call with the target token and account states. Do not use these numbers as a production reward or `fee_limit`.

The model explains the likely result: your new path still executes three token movements overall—deposit, merchant payout, reward payout—and adds per-order contract creation. Resource pooling across recurring executors can simplify activation and Energy management, but compare it against an HD service using the same staking/rental optimization. For native TRX, ordinary EOA transfers require Bandwidth rather than contract Energy, so adding contract deployment is an especially clear extra resource expense.

If cost is the priority, benchmark reusable merchant receivers or a shared router. The former amortizes deployment but loses unique-address invoice matching. The latter avoids per-order receivers but needs a contract-aware wallet; ordinary USDT allowance can require an approval transaction. Merchant self-settlement avoids paying a separate executor token transfer but changes the actor responsible for operation. See [TRON-COST-NOTES.md](TRON-COST-NOTES.md) for source evidence, activation rules and a concrete USDT return-value compatibility finding.

## Solana: feasible and inexpensive, with storage tradeoffs

Use one program and per-order PDAs. Under one customer signature, one executor signature and one off-chain merchant-signature verification, the two-transaction base fee is **15,000 lamports / 0.000015 SOL**, of which the executor transaction uses **10,000 lamports / 0.000010 SOL**. Priorities, storage, extra signatures and retries are additional. [Solana fee structure](https://solana.com/docs/core/fees/fee-structure)

The live Mainnet rent-exemption query on September 24 returned **0.00148844 SOL for a 165-byte original SPL token account** and **0.00130048 SOL for an example 128-byte order-state account**. These are storage funding requirements, not automatically consumed fees. Eligible account closure can reclaim them, but persistent replay state stays funded. Query the target cluster; do not hardcode older rent numbers. [Rent RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)

An optimized HD sweep can have a sponsor pay fees while the HD account signs; a separate SOL gas top-up is unnecessary. Both HD and PDA token deposit addresses generally need token accounts. Therefore the program path can be close to HD on network fees, but is not automatically cheaper once replay-state storage and executor profit are included. See [SOLANA-COST-NOTES.md](SOLANA-COST-NOTES.md).

## Recommended executor reward

**Estimate and compete off-chain; enforce bounds and payment on-chain.** Do not make reward a simple percentage of the deposit. Ordinary transfer computation is largely independent of value: a 1,000 USDT deposit need not cost ten times as much as 100 USDT.

Let `C` be the current estimated execution cost **before executor margin**, in payment-token units, including resource acquisition, Bandwidth, conversion, and any unrecovered storage costs. If an executor supplies an all-in reward quote that already includes its margin, compare that quote directly to the cap instead of adding another margin. Use integer rounding:

```text
targetReward = ceil(C × (10,000 + marginBps) / 10,000)
rewardCap = min(absoluteCap, deposit × maxFeeBps / 10,000,
                deposit − minimumMerchantReceipt)
accept only if targetReward <= rewardCap
```

For a 1.00 USDT cost quote and a 5% experimental margin, pay 1.05 USDT. If the authorized cap is 0.50, the order is uneconomic: requote/change terms before funding or use an explicitly defined recovery/self-settlement path. Clamping to 0.50 does not cause an executor to accept a loss. Reward covers the network cost plus margin; adding both the entire reward and the same executor network cost double-counts that expense.

Obtain quotes from multiple independent executors. The merchant signs the selected reward within a committed cap; the contract verifies the authorization, preserves a minimum merchant receipt, pays the actual caller once and reverts all transfers on failure. A modest margin is a pricing experiment, not a universal guarantee; failed races and price changes cost money. A bounded increasing bounty is another permissionless option, but it discovers a market price rather than proving exact cost-plus profit.

Ethereum can approximately meter part of execution with `gasleft()` and a capped effective gas price. It cannot read its completed transaction receipt while executing; intrinsic/final work, refunds, arbitrary callbacks, L2 charges and token conversion complicate reimbursement. TRON additionally cannot infer an executor's rental or stake opportunity cost. Solana's message fee and storage responsibilities similarly need off-chain estimation. **There is no simple trustless cross-chain formula guaranteeing precisely “actual total cost plus a tiny profit.”**

For repricing after funding, a new factory version should commit stable base-intent terms, minimum proceeds and maximum reward into the address, while verifying a separate short-lived execution quote. Keep a permanent merchant recovery path for expired quotes/late deposits. The existing fixed `executorFee` is in the address preimage: editing it changes the deposit address. Dynamic quoting and merchant intent signatures are recommendations here, not newly implemented features. Details: [EXECUTOR-FEE-DESIGN.md](EXECUTOR-FEE-DESIGN.md).

## Patterns worth adopting

- **OpenZeppelin:** keep `Clones`, safe token handling and reentrancy protection; use `EIP712` and `SignatureChecker` for the proposed Ethereum signed authorizations. These are primitives, not an automatic gas-pricing service. Validate TVM compiler/opcode/token compatibility separately. [Clones](https://docs.openzeppelin.com/contracts/5.x/api/proxy#Clones), [cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography).
- **TRON GasFree:** a close model for signed off-chain transfer authorization with `maxFee`, nonce, deadline and token-denominated compensation for a provider paying resources. It names a provider and amortizes account activation; copy the capped-fee principle, not its different permission model or sample API fee values. [GasFree](https://docs.gasfree.io/).
- **UniswapX:** signed economic constraints plus competing fillers; its auction prices execution rather than promising an exact gas refund. [UniswapX](https://developers.uniswap.org/docs/liquidity/uniswapx/overview).
- **CoW/Across:** simulation, batching and explicit gas/risk pricing offer useful lessons, but their solver/bridging models differ. References and limitations are in the fee-design note.

**Final recommendation:** keep this architecture if removing custody while preserving unique deposit addresses is the product requirement. For TRON, budget for a non-custodial convenience premium rather than claiming lower network fees; evaluate reusable receivers/router UX if cheap small payments dominate. For Solana, pursue the shared-program design with carefully amortized replay state. For Ethereum, compare an EVM rollup before targeting small payments on L1. Use bounded competitive quotes for executor compensation across all three.
