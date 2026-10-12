# Salute Pay dashboard

The optional Next.js dashboard for Salute Pay’s non-custodial payment protocol includes merchant intent creation, hosted customer checkout, independent executor settlement and wallet-authenticated webhook settings. Its API publishes signed orders and indexes verified chain receipts; it does not hold funds or sign settlement transactions.

**[Open the live Vercel beta](https://salutepay.vercel.app)**

The testnet beta supports all eight activated networks without subscription or monthly payment-link restrictions. Pricing applies to the production app. The dashboard restores an already-authorized wallet and selected network on refresh, and preserves them when moving between workspace pages.

Use the [project README](../README.md#test-the-project-on-vercel) for the hosted walkthrough: connect a wallet, mint test tokens, create an intent, fund the payment address, then review and settle through Executor. The [core contract explorer links](../README.md#deployed-core-contracts) identify all activated protocol deployments.

- [Create payments](https://salutepay.vercel.app/app)
- [Executor](https://salutepay.vercel.app/executor)
- [Developer settings](https://salutepay.vercel.app/developer)
- [Developer documentation](https://salutepay.vercel.app/docs)

Tempo and Solana are the primary networks. EVM wallets support Tempo, Ethereum, Base, Arbitrum, BNB Chain and Robinhood; Wallet Standard supports Solana; TronLink supports TRON. Minted sUSD has no monetary value and does not supply transaction gas. SPL address setup requires separately sponsored rent.

The frontend and API deploy together on Vercel, backed by PostgreSQL and an authenticated external receipt-watcher/webhook scheduler. Operator configuration is documented in the [deployment guide](../docs/DEPLOYMENT.md). Signed-order exports support independent execution; hosted indexing and webhooks remain optional conveniences.
