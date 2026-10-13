# Main Salute payment architecture

This repository contains one main EVM collection protocol, one Solana program and one TRON implementation. The EVM source is `contracts/PaymentCollection.sol`; the Solana source is `solana/programs/salute_pay/src/lib.rs`; TRON uses `tron/contracts/SaluteTron.sol`. Superseded contract implementations and executable flows were removed. No persistent `.data` state or deployment history was deleted. Old funded addresses and old signed links do not become main-protocol addresses; keep their exported data for independent historical execution.

The EVM EIP-712 domain retains the explicit cryptographic version `4` to reject incompatible old signatures. This is an authentication-domain constant, not a choice of protocol versions in the app. EVM base intent authorization fixes the origin chain and canonical factory. Solana uses Ed25519 and TRON uses TIP-712; neither is an EIP-712/CREATE2 EVM rail.

## Merchant, customer, executor and platform

The merchant signs an order off-chain, selects an asset, expected invoice amount and fixed reward per sweep, then publishes it or exports an offline link. Merchant payout is immutable. The publisher stores the signed order, issues a random dedicated `/pay/{slug}` link, and optionally exposes the order to the public executor queue. Browser-local order data is a fallback, not a global database.

The customer funds the unique address. Exchange withdrawals require no customer wallet signature. The payment page shows amount, token, chain, QR/address and a wrong-network warning. Underpayments and overpayments remain collectable; their accounting status differs. A customer refund is a separate merchant process; the protocol never assumes an exchange's sender address is a valid refund recipient.

Any executor connects the relevant wallet, verifies merchant authorization and fixed receiver address, reviews payout and sends collection. An EVM receiver is created only after funding; initial deployment and payouts revert together on failure. A zero-reward sweep or reward waiver performs only the merchant transfer. It still costs a transaction fee paid by the executor; the merchant can sponsor by being that executor. Several deposits accumulated before one sweep pay one sweep reward. Repeated sweeps can each pay the signed fixed reward.

Salute supplies optional publishing, dashboard, indexing and webhook infrastructure. It has no custody signing key, payout setter or contract admin. The dashboard subscription does not restrict independent contract access. Wallet sessions authorize app settings, not settlement authority. Public signed order data permits independent execution if the app is unavailable.

## Portable EVM collection

Identical deterministic deployment roots, factory initialization bytecode and salt yield identical factories on compatible EVM networks. Its nonce-1 implementation and fixed clone arguments then yield identical deposit addresses. Changing factory address, deployment bytecode, fixed order terms or salt changes the address. Keep compiled release artifacts pinned. The deployment scripts verify the bootstrap proxy and factory runtime; they never silently bootstrap an absent proxy.

Wrong-chain recovery uses the unchanged base signed order. The signature domain uses the signed origin chain; reward quotes use the actual execution chain and actual asset. Cross-chain reward authorizations also bind order digest, nonce, deadline and positive minimum merchant receipt. Nonces and payouts commit atomically. Foreign-chain/wrong-token recovery defaults to sponsorship. Recovery pays the fixed merchant on the chain where the funds arrived; it does not bridge or exchange assets.

EOA merchant signatures are portable. ERC-1271 validation is supported only on the origin chain because foreign wallet state does not prove origin authorization. Ordinary transferable fixed-balance ERC-20s and native balances are supported. Exact token recipient balance checks reject fee-on-transfer, rebasing or policy-redirection behavior. Issuer freezes cannot be overridden. Tempo collects transferable TIP-20s and has no native-payment path.

## Solana and TRON

Solana signs a network-domain/program/terms-bound message and derives an order PDA plus vault. Native SOL can be prefunded if the first balance meets Solana rent-exemption requirements; the merchant can optionally prepare the vault for smaller deposits. It is then registered and collected atomically by the executor. The executor pays order-account and vault rent; the vault's reserved rent is excluded from customer payments and retained for later deposits. Classic SPL payment accounts require setup before an exchange funds the ATA. The merchant sponsors that setup in the app and can retry it from the order details. Wallet checkout can create a missing vault ATA immediately before the token transfer in the same transaction; the payer sponsors that token-account rent in SOL separately from the invoice. If the order is still unregistered, registration and its remaining rent are sponsored separately before collection. Subsequent customer transfers and collection use the prepared address. There are no arbitrary field mutation functions. Public deployment revokes upgrade authority before activation. Wrong-mint/native collection goes to the same merchant; no EVM cross-chain equivalence is claimed.

TRON uses a dedicated TVM CREATE2 derivation and TIP-712 factory. It supports TRX and ordinary transferable TRC-20s, partial/excess deposits, later sweeps, fixed rewards per sweep and sponsorship. Resource costs are Bandwidth/Energy, not Ethereum gas. No EVM wrong-chain address equivalence is claimed.

## Shared app and database

The frontend runs Next.js on Vercel-compatible Node routes. PostgreSQL (for example Neon) persists merchant profiles, one-use auth challenges, hashed sessions, signed payments, immutable collection receipts, indexing cursors and webhook deliveries. Database credentials are server-only. Production uses pooled connections; the app pool is bounded to three connections per instance.

EVM dashboard authentication currently supports EOAs; origin-chain ERC-1271 remains available to independent contract integrations. Wallet authentication uses an origin-bound challenge expiring in five minutes and a single-use database row. Authenticated sessions expire after twelve hours, use hashed tokens, HttpOnly cookies and SameSite=Strict. Writes require the configured app origin. Merchant records lock during publication so concurrent requests cannot exceed the monthly dashboard quota. Plan changes are an operator-only SQL CLI action; browser clients cannot upgrade themselves. Billing checkout is not implemented. Limits are 20 links for Free on Ethereum/Base/Arbitrum, 1,000 links for Growth ($49), unlimited for Scale ($99), resetting monthly UTC. Paid support requires actual staffing.

## Verified webhook sender

A merchant saves a public HTTPS URL in Developer settings. Creating a payment defaults webhook delivery on if an endpoint exists; the merchant can opt out per payment. Endpoint and HMAC secret are returned only to the authenticated merchant. The shared database is a convenience index; it does not authorize fund movement.

An authenticated `/api/jobs` run checks chain events/balances and persists accounting plus an outbox event in one transaction. EVM logs are scanned in bounded block ranges after configured confirmations. Solana verifies finalized program event logs, including the program invocation stack. Submitted transaction IDs are candidates only; EVM/Solana/TRON receipts are independently checked before recording collection. EVM wrong-chain/wrong-token receipts do not fulfil the original invoice.

Delivery is at least once; workers claim rows with `FOR UPDATE SKIP LOCKED`, sign the exact raw payload with HMAC-SHA256 over `timestamp.body`, and include stable event IDs. Receivers must deduplicate and enforce timestamp freshness. The sender verifies public DNS answers, pins the checked IP in the HTTPS connection lookup, rejects IP/private destinations and does not follow redirects. Failures retry with backoff up to eight attempts; dead jobs remain available for inspection. The latest merchant webhook destination applies to queued events. Configure an authenticated external scheduler or an eligible Vercel cron; browser polling cannot replace the worker.

The first implementation scans at most 50 payment balances and 40 submitted transactions per job; EVM event cursors scan at most 2,000 blocks per network per run. Solana signature history is bounded and requires prompt scheduling/receipt submission for high-volume orders. TRON collection transactions executed elsewhere must be submitted to the verification endpoint; an external full event indexer is needed for automatic discovery outside the app. These limits need monitoring and scaling for production. Free public RPCs may rate-limit; specify private server-side RPC overrides when necessary.

## Efficiency and security validation

Reviewed OpenZeppelin clones/signature/transfer primitives are retained. One shared factory implementation serves persistent immutable clones; repeat sweeps avoid deployment. Fixed reward sweeps do not write per-order reward state. Zero reward avoids the second outgoing transfer and executor SPL ATA setup. Dynamic reward quotes add signature and nonce-storage cost intentionally. Reentrancy guards and exact token receipt checks add defensive overhead and are retained.

Local gas tests compare first/repeated sponsored token sweeps and rewarded token sweeps; results are simulation measurements, not public-network fee forecasts. Solana rent and TRON resources must be measured separately. A capped reward is not exact transaction-cost reimbursement. Local runtime, integration and adversarial checks are not an independent audit. Public deployments remain unverified until separately activated.
