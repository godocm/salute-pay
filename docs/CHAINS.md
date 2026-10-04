# Ethereum, TRON, and Solana payment architecture

Research checked **2026-09-23** against the primary sources linked below. Ethereum/EVM, TRON TVM, and Solana now have local implementations. The TRON and Solana native/token paths passed local-chain tests on 2026-10-05. Neither port has a public-network deployment or independent audit. Cost examples are arithmetic illustrations, not deployed benchmarks or dollar quotes.

## What becomes decentralized

The intended architecture removes the gateway's deposit private keys and pooled cold-wallet custody: a contract enforces the merchant destination and executor reward, and any funded executor can request settlement. Customers still submit a payment transaction, and an executor must submit a separate settlement transaction. A balance appearing at an address does not automatically run code.

Permissionless settlement is one property, not a guarantee that every part of the service is decentralized. Publish order terms in retrievable on-chain data, publish the client and contract source, allow independent RPCs and indexers, and make the executor reproducible. A browser database is a cache; it must not be the only place that records a payable order's terms. Any retained upgrade/admin key is another trust dependency. Token issuers can also have freezing or administrative powers independent of this gateway.

The executor reward is paid from the deposit asset; network fees are paid up front in ETH, TRX, or SOL. Therefore a stablecoin reward does not supply the native token needed to submit the transaction. In an open executor market, another executor can copy a pending settlement and win the reward first. This must never let it change the merchant or split, but it can leave losing executors paying for failed transactions. Quote enough reward for network cost, conversion, and competition; execution is not guaranteed when it is unprofitable.

## Ethereum: the direct fit

`CREATE2` derives an address from the factory, salt, and hash of the creation bytecode, including constructor arguments. Bind all payout terms into that derivation or an immutable on-chain order commitment. Anybody must obtain the same merchant, asset, amount, and reward for a given order. ETH prefunding alone does not prevent deployment: the collision rules check account nonce or code rather than the balance. ERC-20 balances live in the token contract, so ordinary compatible tokens can be transferred to a counterfactual address before its code exists. These conclusions follow from the address derivation and creation-collision rules in [EIP-1014](https://eips.ethereum.org/EIPS/eip-1014).

A small persistent forwarder makes late deposits recoverable. Avoid a design that destroys an order contract and assumes that recreating it is harmless: settlement history, late payments, and one-time reward semantics need explicit handling. Storing every order on-chain before payment costs a transaction even for abandoned checkouts; keeping only a signed order off-chain reduces that cost but introduces a separate data-availability requirement. This is a product tradeoff, not something `CREATE2` removes.

For an EIP-1559 execution transaction, the fee is `gasUsed × effectiveGasPrice`, where the effective gas price includes the base fee and priority fee. Obtain gas from simulation and the eventual receipt, not a generic transfer estimate. The complete order cost includes registration, customer deposit, and deploy-and-settle. [Ethereum gas documentation](https://ethereum.org/developers/docs/gas/)

If compatibility is the priority, benchmark the same design on an appropriate EVM rollup as well. Include that chain's data-posting charges and supported compiler/opcodes; an Ethereum gas count alone is not its complete fee quote. This is an engineering recommendation, not a claim that every rollup is always cheaper.

## TRON: feasible, with TVM-specific deployment and resources

Use a factory and compact order receiver with the same immutable split and permissionless settlement interface. Port and compile for the target TVM rather than deploying an Ethereum artifact unchanged. TVM's `CREATE2` hash domain byte is **`0x41`**, versus Ethereum's `0xff`. TRON also represents external addresses using its network prefix/Base58Check format. These are different encoding concerns; use TRON tooling and verify factory prediction against an actual deployed receiver. [TRON migration guide](https://developers.tron.network/docs/migrating-eth-contracts-to-tron), [TVM opcode reference](https://developers.tron.network/docs/opcodes)

### Funding before deployment

Do **not** assume that a TRX transfer activating the predicted address permanently prevents its deployment. The released java-tron `GreatVoyage-v4.8.2.2` implementation, in `createContractImpl`, permits an existing account without a contract record to become a contract when `allowTvmConstantinople` is enabled. `isContractExist` checks the contract repository. The live Mainnet parameter endpoint returned `getAllowTvmConstantinople = 1` and `getAllowTvmIstanbul = 1` when checked. Thus native prefunding is supported by the examined code path; the activation itself is not a blanket CREATE2 blocker. [Released VM implementation](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.2/actuator/src/main/java/org/tron/core/vm/program/Program.java#L771), [live chain parameters](https://api.trongrid.io/wallet/getchainparameters)

The [local TVM prototype](../tron/contracts/SaluteTron.sol) has now tested native prefunding, mock TRC-20 prefunding, exact bytecode prediction, and settlement on TRE. This does not establish behavior on a selected public network or with real USDT. Before offering deposit addresses, test deliberate dust activation, exact token behavior, and settlement on the selected network and node version.

TRC-20 balances are recorded by the token contract; a balance at an address is distinct from account activation. Query the exact token's `balanceOf`, and test its transfer rules and wallet/exchange acceptance of undeployed destinations. Do not automatically fund every TRC-20 deposit address with TRX just to make it visible in an explorer. The executor can call the factory and pay execution resources. [TRON account and balance model](https://developers.tron.network/docs/account)

### Cost model

TRON charges Bandwidth for transaction bytes and Energy for contract computation. Staking or delegated resources can reduce TRX burning but have an economic cost. Both receiver deployment and transfers consume resources; a popular token can also carry a dynamic Energy multiplier. [Resource model](https://developers.tron.network/docs/resource-model), [resource payment and dynamic Energy](https://developers.tron.network/docs/paying-for-resources)

The live Mainnet endpoint returned these values on 2026-09-23:

- `getEnergyFee = 100` sun/Energy.
- `getTransactionFee = 1,000` sun/Bandwidth byte.
- `getCreateNewAccountFeeInSystemContract = 1,000,000` sun.
- `getCreateAccountFee = 100,000` sun.
- `getMaxFeeLimit = 15,000,000,000` sun.

One TRX is 1,000,000 sun. Refresh these governance-controlled values before quoting. Ordinary account activation and contract-mediated activation have different charges; include the applicable path rather than adding all charges to every transaction. [Live parameters](https://api.trongrid.io/wallet/getchainparameters), [account activation](https://developers.tron.network/docs/account)

For a normal smart-contract transaction, an approximate burn-only calculation is:

`TRX burned = (uncovered Energy × energy price + Bandwidth charged in sun + applicable fixed fees) / 1,000,000`.

For illustration only, **100,000 uncovered Energy** at the observed price costs **10 TRX**, before Bandwidth and other applicable charges. This is not the measured Energy of this gateway. Estimate the exact factory call with `estimateenergy` where supported or `triggerconstantcontract`, include dynamic penalties, then validate against receipts. `fee_limit` bounds the caller's Energy budget; it is not the amount necessarily spent and does not make resources free. [FeeLimit and estimation](https://developers.tron.network/docs/set-feelimit)

**Assessment:** feasible, but deployment plus multiple TRC-20 transfers is not automatically cheaper than Ethereum or an EVM rollup. Benchmark the actual token, receiver, account state, and resource strategy. A single shared router is worth testing if customer wallets can send an order ID with a contract call; it avoids receiver deployment but changes the deposit experience.

## Solana: use one program and per-order accounts

Deploy **one payment program**, then derive per-order addresses from seeds such as a protocol version, merchant public key, and unique order ID. A PDA has no private key; the deriving program can authorize operations through `invoke_signed`. Program code and mutable order data live in separate accounts. Do not deploy a program per deposit. [Program-derived addresses](https://solana.com/docs/core/pda), [program model](https://solana.com/docs/core/programs)

Recommended design:

1. Register immutable order terms in an order PDA: merchant, mint/native asset, amount, executor reward, nonce, and settlement status. This incurs storage funding before payment if terms must already be on-chain.
2. Derive a distinct vault PDA and, for tokens, its associated token account for the exact mint and token program.
3. The customer deposits; any executor calls `settle` with the order, vault, merchant destination, executor destination, and required programs.
4. The program validates every address, owner, mint, authority, balance, and order state; it updates settlement state and splits funds atomically. For tokens, use `TransferChecked` with mint decimals. For SOL, use the vault's appropriate ownership/signing path.

This design is implemented for native SOL and classic SPL tokens in [the local program](../solana/programs/salute_pay/src/lib.rs). The local smoke test covers partial funding, settlement, reward, wrong recipient rejection, and late sweeps. The platform supplies the primitives, not these gateway validations. [PDA account creation/signing](https://solana.com/docs/core/pda/pda-accounts), [checked token transfer](https://solana.com/docs/tokens/basics/transfer-tokens)

### Native SOL and token prefunding differ

SOL can fund a derived address before your order data is initialized. A zero-data, System Program-owned vault PDA can be spent by a System Program CPI signed by the payment program. Keep order state in a separate PDA. If you instead initialize data at the prefunded address, ordinary `CreateAccount` rejects an already funded account; validate that it is System-owned and empty, add any missing storage balance, and use `Allocate` plus `Assign` with `invoke_signed`. Current Agave source also contains a feature-gated `CreateAccountAllowPrefund`; do not assume it is enabled everywhere. Account balances must satisfy the target cluster's storage rules. [System Program implementation](https://github.com/anza-xyz/agave/blob/master/programs/system/src/system_processor.rs), [account storage rules](https://solana.com/docs/core/accounts)

SPL tokens require an **initialized token account before the transfer**. The payer can create the vault ATA and transfer in one transaction, or the merchant can create it beforehand. A bare PDA is an authority, not a token balance container. Some exchange withdrawal flows cannot construct the needed ATA-creation transaction or accept an off-curve destination, so test real funding clients. [Solana payment address verification](https://solana.com/docs/payments/send-payments/verify-address)

Closing an empty token account recovers its storage lamports to the destination selected by its authority; they do not automatically go back to the account creator. Specify that recipient in the protocol. Keep durable settlement/replay state if closing other accounts, and retain a deterministic recovery path for late deposits. Otherwise an address can be re-funded after settlement with no usable order state, or reinitialization can accidentally make the one-time reward payable again. The closure behavior is documented; these replay and recovery requirements are design implications. [Token account closure](https://solana.com/docs/tokens/basics/close-account)

Start with an explicitly supported Token Program and mint. Token-2022 extensions can change transfer amounts, account sizes, account requirements, or execution; supporting all extensions requires separate handling. [Token extension guide](https://www.solana-program.com/docs/token-2022/extensions)

### Cost model

Solana's documented base fee is **5,000 lamports per charged signature**, or **0.000005 SOL** for one signature. Legacy/v0 priority fees add `ceil(CU limit × micro-lamports per CU / 1,000,000)` lamports. Use the fee appropriate to the actual transaction format and cluster. Three separately submitted single-signature transactions for registration, deposit, and settlement have an illustrative base-fee total of **0.000015 SOL**, before priority fees, account creation, and any extra signature-verification charges. [Solana fees](https://solana.com/docs/core/fees)

Query `getMinimumBalanceForRentExemption` for the real account sizes; distinguish refundable storage funding from consumed transaction fees. Program/order data, vault token accounts, and missing merchant/executor token accounts can each require funding. A full lifecycle quote is network fees plus unrecovered storage funding and any token-specific transfer fees, with one-time program deployment amortized separately. [Storage-balance RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)

**Assessment:** the local implementation establishes feasibility for native SOL and classic SPL tokens. Wallet/exchange compatibility, devnet/mainnet operation, storage funding, priority fees, failed executor races, and operational costs remain to be measured. The local deployment retains upgrade authority for iteration; a public release must remove it after review to make the vault rules immutable. [Program upgrade model](https://solana.com/docs/core/programs)
