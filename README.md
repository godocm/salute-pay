# Salute Pay

Salute Pay is a non-custodial payment and settlement protocol. A merchant signs an order intent with a fixed payout address, payment asset, invoice amount and optional executor reward. The customer funds the order’s unique address; any executor can settle the available balance directly to the merchant under those signed terms.

Salute supplies an optional dashboard for payment links, order history, verified receipts and webhooks. The dashboard and database do not hold customer funds or control the merchant destination. Tempo and Solana are the primary networks, alongside Ethereum, Base, Arbitrum, BNB Chain, Robinhood and TRON.

**[Open the live Vercel beta](https://salutepay.vercel.app)** · [Create payments](https://salutepay.vercel.app/app) · [Executor](https://salutepay.vercel.app/executor) · [Developer docs](https://salutepay.vercel.app/docs)

The beta uses eight public testnets and valueless test assets. Every activated testnet is available without a subscription or monthly payment-link limit. [Pricing](https://salutepay.vercel.app/pricing.html) applies to the production app. Network costs, account rent and merchant-authorized executor rewards still apply in test assets.

## Test the project on Vercel

### 1. Connect a wallet and select a testnet

Open [Create payments](https://salutepay.vercel.app/app), choose a network and connect a compatible wallet: an EVM wallet for Tempo and the other EVM networks, Phantom/Solflare for Solana, or TronLink for TRON. Base Sepolia is a straightforward first walkthrough.

Fund each transaction sender with the selected network’s test gas asset. The merchant, payer and executor can use separate wallet accounts to demonstrate independent settlement. On Tempo, fund the configured fee stablecoin and use **Prepare gas token** before minting or sending transactions. On Solana, keep Devnet SOL for transaction fees and token-account rent; on TRON, keep Nile TRX for fees/resources.

The selected network and an already-authorized wallet connection are restored on refresh and retained between Payments, Developer settings and Executor. A valid matching login session is reused. Signing each new order and approving transactions remain separate wallet actions.

### 2. Mint test payment tokens

Click **Mint test tokens** and approve the transaction to receive 1,000 valueless sUSD on the selected network. This button mints payment tokens; it does not supply native gas coins.

Mint to the wallet that will fund the invoice. If using a separate payer, connect that account to mint, then return to the merchant account before creating the intent.

### 3. Create an order intent

Enter a reference such as `Demo invoice 1042`, an invoice amount of **100 sUSD**, and an executor reward of **2 sUSD per sweep**. Keep **Publish a hosted payment link** and **Publish to the executor queue** selected. Webhook delivery is optional.

Click **Sign & create payment** and approve the merchant’s order signature and any required login signature. For Solana SPL payments, also approve merchant-funded payment-address setup. Copy the payment link and export the signed-order JSON as a backup.

The merchant destination is fixed by the signed order. Creating an EVM order does not deploy an unfunded receiver contract.

### 4. Fund the payment address

Open the generated customer payment link. Confirm the displayed testnet, asset and payment address, then transfer **100 test sUSD** from the payer wallet. You can copy or scan the address and send directly from your wallet, or connect on the checkout page and use the fixed **Pay** button.

A customer does not need to connect a wallet to Salute when paying by address. Wait for confirmation and the hosted watcher’s verified status; funding and merchant settlement are separate steps.

### 5. Settle through Executor

Open [Executor](https://salutepay.vercel.app/executor), select the same network and connect an executor account funded for transaction costs. Refresh the queue and open the funded intent. You can also import the hosted link or exported signed JSON.

Click **Review settlement**, check the fixed merchant destination and payout amounts, then click **Send & sign settlement** and approve collection. For a 100 sUSD balance with a 2 sUSD reward, an independent rewarded executor sends **98 sUSD to the merchant** and receives **2 sUSD**. The reward is gross compensation; the executor also pays network costs.

If the merchant collects their own order, or the executor sponsors a sweep with no reward, the available balance goes to the merchant. A zero reward does not remove transaction costs. Partial and excess balances can also be collected, and late deposits can be swept again.

### 6. Verify the result

Inspect the collection receipt in the app and follow its transaction explorer link. Confirm the merchant’s actual token receipt, then refresh the hosted payment page after indexing catches up. Invoice funding status and collection status are shown separately.

For optional integration testing, save your public HTTPS endpoint in [Developer settings](https://salutepay.vercel.app/developer) and choose **Send webhook events** when creating a hosted intent. Verify signatures on your server using the provided signing secret. Delivery follows the scheduled watcher; receipt confirmation and RPC delays can add time. See [Webhook documentation](https://salutepay.vercel.app/docs#webhooks).

## Deployed core contracts

The following links identify the activated payment factories, receiver implementations and Solana program—not the test-token contracts. Factory/program addresses come from the [verified public registry](portal/public/deployments/main.json); receiver implementations were read from their factories on **13 October 2026**. Each customer order receives its own derived payment address.

- **Tempo Moderato** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://explore.testnet.tempo.xyz/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://explore.testnet.tempo.xyz/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **Solana Devnet** — Program: [4soYk2h6YM9mAn3WWTCLgvzEGA5V1jWacupCASzY14zS](https://explorer.solana.com/address/4soYk2h6YM9mAn3WWTCLgvzEGA5V1jWacupCASzY14zS?cluster=devnet). The deployed program’s upgrade authority has been revoked.
- **Ethereum Sepolia** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://sepolia.etherscan.io/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://sepolia.etherscan.io/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **Base Sepolia** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://sepolia.basescan.org/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://sepolia.basescan.org/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **Arbitrum Sepolia** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://sepolia.arbiscan.io/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://sepolia.arbiscan.io/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **BNB Smart Chain Testnet** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://testnet.bscscan.com/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://testnet.bscscan.com/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **Robinhood Testnet** — Factory: [0xEcdf8B90e83b4069444eEF009055E3174654CAb3](https://explorer.testnet.chain.robinhood.com/address/0xEcdf8B90e83b4069444eEF009055E3174654CAb3); receiver implementation: [0x7d83DAA23f130164EADa5e86993066dD473A42FD](https://explorer.testnet.chain.robinhood.com/address/0x7d83DAA23f130164EADa5e86993066dD473A42FD).
- **TRON Nile** — Factory: [TNSjMTiHYgM1nvFxZ6iDcqMMxjZqhX4LcL](https://nile.tronscan.org/#/contract/TNSjMTiHYgM1nvFxZ6iDcqMMxjZqhX4LcL/code); receiver implementation: [TTWSj4WdYRxWo7Fsv9c14TAURsFB7HgKii](https://nile.tronscan.org/#/contract/TTWSj4WdYRxWo7Fsv9c14TAURsFB7HgKii/code).

## Protocol boundaries

The merchant’s payout destination is immutable. No customer refunds, cancellation/expiry, bridging, token exchange or exact-cost reward reimbursement are implemented. Frozen, fee-on-transfer and rebasing assets are unsupported. Solana and TRON are separate settlement rails; EVM recovery depends on matching canonical factory and implementation identities.

The current release is a public testnet beta, not an independently audited production deployment. Test tokens have no monetary value. Keep signed-order exports and transaction receipts for independent verification and execution.

[Architecture](docs/ARCHITECTURE.md) · [Deployment guide](docs/DEPLOYMENT.md) · [About](https://salutepay.vercel.app/about) · [Contact support](mailto:support@salutebank.com)
