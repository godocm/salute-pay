# Solana deposit and settlement cost notes

Checked **2026-09-24**. These are protocol-design conclusions, documented fee rules and read-only Mainnet RPC observations. This repository has no implemented or measured Solana payment program. No transactions were broadcast for this research.

## Recommended architecture and transaction count

Deploy one payment program and derive a vault PDA from the complete immutable order commitment. A PDA has no private key; the deriving program authorizes it using `invoke_signed`. This supplies the custody-free primitive without deploying executable code for every order. Keep a separate order/settlement-state account or a sharded replay bitmap. [Solana PDAs](https://solana.com/docs/core/pda)

For a signed off-chain intent, the intended flow is:

1. Customer funds the deterministic vault. For SOL this can be a normal System Program transfer to a zero-data System-owned PDA. For an ordinary SPL token, create the vault ATA if necessary, then transfer the token into it.
2. Executor submits signature verification and settlement in one transaction. The program checks the signed terms, commitment, destinations and balance; records settlement; sends merchant proceeds and executor reward; optionally closes the now-empty token vault to its agreed storage-refund destination.

**Two transactions is feasible**, provided required account creation fits into those transactions and the customer wallet supports the necessary instructions. Multiple instructions can execute atomically in one transaction. This is a proposed design, not a tested implementation. [Solana transactions](https://solana.com/docs/core/transactions)

Token deposits cannot be transferred to an uninitialized token account. An ATA may be derived from a PDA authority, but the ATA must exist before its token-transfer instruction executes. A compatible wallet can combine ATA creation and payment. An exchange that only supports a plain withdrawal may need a separate preparation transaction, making **three transactions**. Independently registering every order beforehand also adds a transaction. Normal token transfers do not need an Ethereum-style approval transaction when the customer signs as transfer authority. [Token account creation](https://solana.com/docs/tokens/basics/create-token-account), [token transfer](https://solana.com/docs/tokens/basics/transfer-tokens), [payment destination verification](https://solana.com/docs/payments/send-payments/verify-address)

## Consumed fees versus storage deposits

The documented base fee is **5,000 lamports per charged signature**. Charges include Ed25519 precompile verification of an off-chain signature. Therefore one customer signature plus one executor signature plus one merchant-intent verification gives an illustrative total of **15,000 lamports = 0.000015 SOL**, before priorities, storage and retries. The executor transaction alone has **10,000 lamports = 0.000010 SOL** of base fees under these assumptions. PDA CPI authorization does not add an ordinary transaction signature. [Fee structure](https://solana.com/docs/core/fees/fee-structure), [precompiles](https://solana.com/docs/core/programs/precompiles)

For legacy/v0 transactions, add `ceil(CU_limit × micro_lamports_per_CU / 1,000,000)` lamports. The requested limit determines this priority fee, not actual consumed CUs. For example, a **hypothetical**, unmeasured 100,000-CU limit at 1,000 micro-lamports/CU adds 100 lamports. Other transaction formats must use their own fee rule. [Solana fees](https://solana.com/docs/core/fees)

Storage lamports are distinct from consumed network fees. A closed account's storage balance can be reclaimed. Settlement-state storage that must remain to prevent replay stays funded. [Account structure](https://solana.com/docs/core/accounts/account-structure)

### Live Mainnet storage observation

At **2026-09-24 15:26:20 UTC**, read-only `getMinimumBalanceForRentExemption` calls to `https://api.mainnet-beta.solana.com` with `finalized` commitment returned:

- 0 data bytes: **650,240 lamports = 0.00065024 SOL**.
- 64 data bytes: **975,360 lamports = 0.00097536 SOL**.
- 128 data bytes: **1,300,480 lamports = 0.00130048 SOL**.
- 165 data bytes, the original SPL Token account layout: **1,488,440 lamports = 0.00148844 SOL**.

The endpoint reported `solana-core: 4.3.0`, feature set `3383571666`, epoch `1041`, and finalized slot `450068966`. A second read of `SysvarRent111111111111111111111111111111111` at slot `450069098` returned base64 `2BMAAAAAAAAAAAAAAADwPzI=`: `lamports_per_byte_year = 5080`, `exemption_threshold = 1.0`, `burn_percent = 50`. The observed minimum follows `(data_bytes + 128) × 5080`.

**Do not use the older 0.00203928 SOL token-account minimum as a current fixed constant.** That number was still printed in the ATA documentation when inspected, while the live query above returned a lower value. The documentation itself instructs applications to query the target cluster. These observations are snapshots, not a future fee guarantee. [Rent-exemption RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption), [ATA documentation](https://solana.com/docs/tokens/basics/create-token-account)

A new native SOL vault also needs the target cluster's zero-data minimum when first funded; sufficiently small first transfers can fail. Its existing payment balance can satisfy that minimum, so it is not necessarily an extra fee added on top of the payment. A sponsored sweep can drain it to zero. Token-2022 extensions may require larger token accounts; query the actual size for the supported mint.

## Fair comparison with unique HD deposit wallets

An HD address is derived off-chain, so deriving it is free. For tokens, both an HD-address design and a PDA-vault design generally need a token account per unique deposit destination and mint. Both can close empty token accounts; the cost of a unique token account must not be charged only to the PDA architecture.

**HD direct-to-merchant flow can also be two transactions:** customer deposit, followed by sweep. Solana allows a separate sponsor to pay the sweep fee while the HD key signs the token transfer. Therefore a separate SOL top-up transaction is unnecessary. Such a sponsored sweep usually has two transaction signatures; adding the customer's one-signature deposit gives the same illustrative three-signature base total as the signed-intent example. If the HD account itself pays and has SOL, its sweep can instead have one signature. [Fee sponsorship](https://solana.com/docs/payments/send-payments/payment-processing/fee-abstraction)

For the existing **deposit → pooled cold wallet → merchant payout** business flow, the comparison is two transactions for direct intent settlement versus three when each cold-wallet payout is separate. If cold-wallet payouts aggregate multiple deposits, allocate their fee across those deposits. If either design needs separate ATA preparation, add that preparation consistently. Batching can also amortize signatures and replay-state storage in a program design, subject to transaction limits.

The PDA design adds program execution, signature verification, durable settlement/replay state and executor profit. It removes the gateway's deposit signing keys and can remove a later cold-wallet payout. Therefore it is plausible for costs to be close on Solana, but **it is not proven cheaper than an optimized HD workflow**. The main benefit is reduced gateway custody. Network transaction fees are small; account storage policy can dominate the capital required per fresh order.

Closing a token vault sends its lamports to the destination specified by the close instruction, not automatically to whoever funded its creation. Bind this destination into the intent/protocol. Do not count the whole storage balance as executor profit or let the executor take a customer's storage refund accidentally. [Token account closure](https://solana.com/docs/tokens/basics/close-account)

Keep durable replay protection when reclaiming account storage. Otherwise the same signed intent and re-funded address could be initialized again and earn a second initial-settlement reward. A bitmap or another compressed spent-intent design can amortize storage, but concurrency, deletion, retention and late-deposit recovery need explicit design. These are engineering implications of a reusable deterministic address, not platform defaults.

## Executor reward recommendation

Use an off-chain estimate/competitive quote with merchant-signed limits, enforced on-chain. The program should verify exact order/domain/asset data, a minimum merchant receipt, a maximum reward, a quote deadline or bounded escalation schedule, and one-time reward state. Deposit amount is useful for a fee cap, not as a measure of processing cost.

An illustrative quote rule is `targetReward = estimatedNetworkFee + unrecoveredExecutorFundedStorage + margin`, converted to the reward asset if necessary; accept only when `targetReward <= maxReward`. Do not silently clamp an uneconomic quote and promise execution. Storage expected to be refunded to that executor must not also be reimbursed as a consumed cost. A quote of only base fee plus 10% can be far too low if the executor must permanently fund an order-state account; conversely, charging for every ATA as permanently lost overstates cost when the same transaction closes and refunds it.

Use simulation for compute and account requirements and `getFeeForMessage` for the fully assembled message. Do not treat an executor-reported fee or its freely chosen priority bid as proof of a reasonable reimbursement. There is no general trustworthy in-program receipt oracle for the executor's complete economic cost; the old Fees sysvar is deprecated and its SDK documentation recommends RPC fee calculation. [Fee-message RPC](https://solana.com/docs/rpc/http/getfeeformessage), [Solana SDK Fees sysvar](https://docs.rs/solana-sdk/latest/solana_sdk/sysvar/fees/index.html)

For token-denominated rewards, agree the SOL/token conversion in a bounded signed quote or use a checked price feed. The executor still needs SOL up front. Exact fee reimbursement plus a guaranteed small profit cannot be promised under arbitrary priority bids, exchange costs, failed races and storage responsibilities. If the signed cap is uneconomic, execution may wait; never silently reduce the merchant's guaranteed amount.

**Decision:** Solana is a strong technical candidate for this non-custodial payment design. Use one program and per-order PDAs, build a compatible two-transaction wallet path, separately support exchange withdrawals, and benchmark complete successful and failed lifecycles. No exact compute-unit figure for this gateway is available until that program exists and is measured.
