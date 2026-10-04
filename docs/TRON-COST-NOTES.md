# TRON settlement economics — research and read-only measurements

Checked 2026-09-24. This repository currently implements Ethereum/EVM contracts. **No TRON version of the gateway was deployed, simulated, or benchmarked here.** Public Mainnet RPC calls below only read state or simulate existing USDT transfers; nothing was signed or broadcast. All gateway totals are explicitly component illustrations, not production quotes.

## Decision

The proposed TRON architecture is technically feasible and removes the gateway's deposit-key custody. **A fresh contract per order plus an immediate USDT executor reward is likely more expensive in resources than an optimized HD-wallet sweep.** Two transactions do not imply two token transfers: the customer transfers once, then settlement transfers once to the merchant and once to the executor. Deployment adds work on top. Eliminating individual deposit-account activation and resource management helps operations, but does not normally offset contract deployment plus the reward transfer. This is an engineering inference from the component costs below, not a measured gateway comparison.

Compare both systems under the same resource assumptions. An executor using delegated or rented Energy can look much cheaper than a gateway burning TRX, but the gateway can also use delegated or rented Energy. A merchant self-settling for no separate token reward can avoid one transfer and deserves a separate benchmark.

## Transaction counts

For an off-chain order with accessible terms and a compatible token:

1. Customer transfers USDT to the predicted address: one transaction.
2. Executor calls the factory; it deploys the receiver, validates the terms, and transfers merchant proceeds and the reward atomically: one transaction containing several internal calls.

Total: **two on-chain transactions per successfully paid order**, excluding one-time factory deployment, optional on-chain order announcement, retries, refunds, and late deposits. No separate transaction is required for each internal token transfer. The executor must already have resources or TRX; its eventual USDT reward cannot pay the up-front network charge.

The traditional full lifecycle is customer deposit → HD-address sweep to cold wallet → cold-wallet merchant payout: **three transfer transactions** before account activation, resource-delegation management, or gas funding. If one merchant withdrawal pays proceeds from N orders, the payout cost is amortized across N; it is misleading to allocate one full cold-wallet payout to each deposit in that case. An HD address that sweeps directly to the merchant has two transfers and no reward split or contract deployment, but retains the HD controller's custody/trust model.

## Current public Mainnet observations

Saved reproducible evidence:

- `tron-chain-parameters-2026-09-24.json`: the public `wallet/getchainparameters` response and retrieval time.
- `tron-usdt-readonly-2026-09-24.json`: USDT contract settings and dynamic factor, recent confirmed event/receipt samples, exact simulation requests and responses, and the optional estimator probe.

The observed governance parameters were **100 sun per Energy**, **1,000 sun per Bandwidth byte**, **1,000,000 sun for normal account creation**, and **100,000 sun for the special account-creation Bandwidth shortfall**. One TRX is 1,000,000 sun. Prices can change; refresh them before quoting. [Live Mainnet chain parameters](https://api.trongrid.io/wallet/getchainparameters)

The token tested was Mainnet USDT, `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, listed by [TronLink's network reference](https://docs.tronlink.org/reference/networks/). Its `contract_state.energy_factor` was **34,000**, corresponding to a **3.4 additional penalty factor / 4.4 total multiplier** for the relevant metered work. A new low-usage factory does not remove a popular token's own penalty. [Dynamic Energy model](https://developers.tron.network/docs/resource-model)

Two read-only `transfer(address,uint256)` simulations of 1 USDT gave:

- Recipient with a nonzero USDT balance: **64,285 Energy**, including **49,635 penalty Energy**. Burn-only Energy equivalent: **6.4285 TRX**.
- Recipient with zero USDT balance: **130,285 Energy**, including **100,635 penalty Energy**. Burn-only Energy equivalent: **13.0285 TRX**.

These are observations of specific ordinary USDT transfers, **not universal TRC-20 constants and not factory-call measurements**. The distinction is token storage balance, not merely whether the address was activated. Sending a different amount usually does not scale computation in proportion to value, although zero transfers, full-balance transfers, issuer configuration, and other execution branches need testing.

Recent confirmed receipts independently showed 64,285 and 130,285 Energy. One 64,285-Energy transfer burned **6.4285 TRX** for Energy and **0.345 TRX** for 345 Bandwidth bytes, totaling **6.7735 TRX**. Another 130,285-Energy transfer used account Energy and only burned **0.345 TRX** for Bandwidth. That is direct evidence that equal computational work does not imply equal TRX burning. The raw receipts are in the snapshot; see also the [transaction receipt API](https://developers.tron.network/reference/gettransactioninfobyid).

`wallet/estimateenergy` returned `this node does not support estimate energy` on the public endpoint. The fallback `wallet/triggerconstantcontract` returned the successful simulations above without consuming account resources. The API explicitly distinguishes estimation from execution and warns that later state changes can invalidate an estimate. [EstimateEnergy](https://developers.tron.network/reference/estimateenergy), [fee budgeting](https://developers.tron.network/docs/set-feelimit)

## What deployment adds

TVM `CREATE2` has a **32,000 Energy** base charge plus memory and init-code hashing. Code storage adds **200 Energy per byte** in the examined released implementation. An illustrative port preserving the EVM prototype's **181 runtime bytes** therefore has **68,200 Energy = 6.82 TRX burn equivalent** for those two deployment components alone. It still needs constructor execution, validation, factory bookkeeping, token calls, events, and any applicable dynamic penalties. A different port's runtime size changes this figure. [TVM opcode reference](https://developers.tron.network/docs/opcodes), [released code-storage tariff](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/EnergyCost.java#L60), [released contract-creation charging](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/program/Program.java#L942)

For scale, adding the ordinary-transfer observations to that deployment component gives the following **illustrative subtotals, with gateway overhead still missing**:

- Executor, merchant and executor already holding nonzero USDT: `68,200 + 2 × 64,285 = 196,770 Energy`, or **19.677 TRX** burn equivalent **before gateway overhead and Bandwidth**.
- Executor, both recipients at zero USDT: `68,200 + 2 × 130,285 = 328,770 Energy`, or **32.877 TRX**, with the same exclusions.
- Customer funding a fresh zero-USDT address adds the observed ordinary-transfer reference of **130,285 Energy / 13.0285 TRX**.

Thus the first illustrative lifecycle subtotal is **327,055 Energy / 32.7055 TRX**, before overhead and Bandwidth. This is **not a guaranteed lower bound or fee quote**: internal-call paths differ from standalone transfers, bytecode changes, dynamic factors differ by contract, and token/account state changes. Estimate and measure the final factory call on the target TVM and exact token before choosing its reward.

Under comparable assumptions, three plain USDT transfers—fresh customer deposit, sweep to an existing cold-wallet balance, and payout to an existing merchant balance—sum to **258,855 Energy / 25.8855 TRX**, before Bandwidth, deposit-account activation, or resource provisioning. Amortizing the payout over N orders changes this illustrative per-order Energy to `130,285 + 64,285 + 64,285/N`. Comparing just sweep-to-merchant uses `130,285 + 64,285 = 194,570 Energy / 19.457 TRX`. These calculations explain why reducing the transaction count from three to two need not reduce total work.

Do not add the full reward to network cost and call both protocol fee burn. The reward pays the executor's resource expense plus margin; only the margin is additional economic compensation after avoiding double counting. It is deducted from the deposit in the current design unless the customer funds it on top of a guaranteed merchant amount.

## Account activation and resource management

A TRC-20 balance is held in the token's ledger, not the TRON account object. A token-funded undeployed receiver does not need an EOA private key or an individual TRX top-up before the executor calls the factory. An HD EOA needs an activated account to originate its own sweep, plus Energy/Bandwidth or TRX. Ordinary TRX/TRC-10 activation has a 1 TRX account-creation charge, and its Bandwidth shortfall uses a special 0.1 TRX charge. Contract-mediated native activation has an extra 25,000 Energy instead; do not stack both mechanisms indiscriminately. [Accounts and activation](https://developers.tron.network/docs/account)

Delegating resources to many fresh EOAs can entail separate activation and delegation transactions, whereas recurring executors can pool resource use in already activated addresses. Delegation/undelegation operations also have transaction overhead. Staked Energy is not economically free: include capital and availability costs. Rented Energy has a market price and provider conditions. This operational benefit can justify the design even when raw Energy consumption is higher. [Stake 2.0 resource APIs](https://developers.tron.network/reference/account-resources), [resource-payment rules](https://developers.tron.network/docs/paying-for-resources)

## Can the contract reimburse exact fees plus a small reward?

It can enforce a bounded reward formula, but **it cannot know the executor's full economic cost exactly from its own execution**.

`gasleft()` / TVM `GAS` reports remaining Energy, so a start/end difference can meter a segment. It omits work before/after that segment and Bandwidth, and requires careful testing of dynamic penalties and nested calls. The native resource unit price also does not reveal whether resources were staked, rented at a discount, delegated, subsidized by the deployer, or paid through TRX burn. Nor does it provide a USDT/TRX exchange rate. A final receipt is only available after execution.

The documentation summarizes `GASPRICE` and `BASEFEE` as returning Energy price, but the released code has a relevant compatibility condition: `GASPRICE` returns the price only if `allowTvmCompatibleEvm` and contract version 1 apply; otherwise it returns zero. `BASEFEE` reads `getEnergyFee`, subject to the opcode being enabled. Do not assume EVM `tx.gasprice` logic is portable or hardcode the present 100-sun parameter. [TVM/EVM differences](https://developers.tron.network/docs/tvm-vs-evm), [released GASPRICE implementation](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/OperationActions.java#L443), [released BASEFEE implementation](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/OperationActions.java#L550)

**Recommended policy:** executors quote settlement in the deposit asset off-chain using current factory-call simulation, their own all-in resource acquisition costs, FX, and an explicit small margin. The merchant authorizes a maximum fee and minimum net receipt; the contract enforces those bounds and pays the winning executor once. Use multiple independently run quote providers or a capped public reward schedule to preserve open execution. The dashboard may suggest a quote but must not be a required signer or settlement gate.

For example, a cost-based quote can be `ceil((simulated resources + expected Bandwidth + overhead allowance) converted to payment-token units × (1 + margin))`, bounded by both an absolute fee cap and a maximum share of the order amount. If the cost exceeds the authorized cap, decline/requote before funding or use an explicit merchant top-up/recovery path. Do not silently clip the quote below viable cost and promise settlement. A 5–15% margin is a starting configuration for testing, not a guaranteed commercially sufficient figure; failed competing transactions and conversion costs matter. Avoid a pure percent-of-deposit reward because computation is largely independent of transferred value.

After funding, current immutable order terms cannot simply be repriced: changing the fee changes the derived address. A future variable-fee version must commit to its cap/schedule before payment and define late-payment, expiry, refund, and merchant self-execution behavior. A short quote expiry by itself must not strand funds that arrive late.

An open capped increasing reward can find the cheapest executor willing to act, but it cannot guarantee a precise cost-plus margin or immediate execution. A named-provider quote reduces racing but grants that provider temporary execution preference; provide an open fallback if using that pattern. Arbitrary user-selected calls or unbounded gas reimbursements would let executors inflate reimbursable work.

## Existing TRON precedent and compatibility finding

[GasFree's official developer documentation](https://docs.gasfree.io/) describes a closely related pattern: a service provider receives an off-chain TIP-712 authorization, pays network resources, and receives a token-denominated fee. Signed fields include token, receiver, amount, **maxFee**, deadline, nonce, and a named service provider. Its provider API quotes separate activation and transfer fees; the documented mechanism is a bounded provider quote, not a universal exact on-chain reimbursement of economic cost. Its account reuse amortizes activation, whereas a fresh receiver per invoice repeats deployment. The named-provider authorization is a different openness model from permissionless execution.

The successful Mainnet USDT simulations in this research returned **32 zero bytes** alongside the expected `Transfer` log. That does not establish return semantics for every call path, but it is a concrete reason to test TRON USDT compatibility instead of deploying the EVM prototype unchanged: OpenZeppelin's EVM `SafeERC20` accepts no return data or an encoded `true`, and rejects an explicit encoded `false`. A narrowly scoped, reviewed token adapter may be needed; merely ignoring every token's return value is unsafe. Require success and exact balance effects for the supported token path and test paused/blacklisted/failure conditions. [OpenZeppelin SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20)

The most useful next benchmark is a TRON test implementation with Mainnet-equivalent USDT behavior, then read-only Mainnet simulation of a deployed verified factory or carefully controlled test transactions: fresh/existing recipient balances, fully drained deposits, zero/nonzero reward, self-settlement, multiple-order batching, dynamic factory penalties, and the actual resource strategy. Until then, market this as **noncustodial payment infrastructure**, not a fee-saving guarantee.

If fee minimization is more important than a unique plain-transfer address for every invoice, benchmark a reusable merchant receiver or a shared payment router. Reusing a receiver amortizes deployment but requires explicit invoice matching, including partial payments and duplicates. A shared router can transfer to the merchant and reward recipient without creating an order contract; ordinary USDT `transferFrom` still requires allowance, so an initial approval may make the wallet flow two transactions. One-call router payment is conditional on pre-existing allowance or a supported authorization mechanism. Direct payment to the merchant is cheaper still, but provides no separate on-chain executor split to enforce. These are alternative product flows, not drop-in optimizations preserving every existing requirement.
