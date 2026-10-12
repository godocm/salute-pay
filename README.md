# Salute Pay

Non-custodial merchant payment links with permissionless collection. The main protocol forwards any supported positive deposit balance to the signed merchant, minus an optional reward per sweep. The company provides an optional dashboard, publisher and webhook service.

The homepage is at `/`, About at `/about` and developer docs at `/docs`. The app has three payment flows: merchant creation at `/app`, execution at `/executor`, and a dedicated customer page at `/pay/{slug}`. Developer settings at `/developer` manage wallet-authenticated webhook delivery. Public network, pricing and integration pages are `/networks.html`, `/pricing.html` and `/integration.html`.

Tempo and Solana are primary networks. Ethereum, Base, Arbitrum, BNB Smart Chain, Robinhood and TRON are additional integration targets. Eight public testnets are deployed: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, BNB Testnet, Tempo Moderato, Robinhood Testnet, TRON Nile and Solana Devnet; current addresses and verification evidence are in `deployments/` and `portal/public/deployments/main.json`. The app activates networks only from verified main deployment metadata.

Use Node 24, `npm install`, `npm --prefix portal install`, `npm --prefix tron install`, and `npm --prefix solana install`. `npm run dev` serves the frontend on loopback 5173. `npm run build` compiles EVM/TRON, exports main ABIs and builds the Next.js app. `npm test` runs isolated main EVM/CLI checks. Preserve `.data` across every run.

The portal source is included directly in this repository; a normal clone includes the dashboard and its API. No submodule setup is required. For a three-minute product recording, use [the demo walkthrough](docs/DEMO.md). Run `npm run test:ui` for invoice-status and executor-review checks.

Customer wallet connection is optional: copy or scan the order address and send the specified asset on the specified network. Merchants sign order terms and executors sign collection transactions. The current public demo uses testnets and valueless test assets; commercial exchanges generally cannot fund these testnet assets.

Hosted links provide cumulative receipt-based accounting, public executor discovery and optional webhooks within dashboard plan limits. Disable **Publish a hosted payment link** to create an offline signed link on any activated rail. Export the signed order for independent execution. Offline links show current balances, not trusted cumulative payment history.

[Architecture](docs/ARCHITECTURE.md) explains EIP-712/Ed25519/TIP-712 authorization, cross-chain recovery, partial/excess deposits, rewards, gas and webhook design. [Deployment](docs/DEPLOYMENT.md) explains Vercel, PostgreSQL/Neon, wallet connector setup, testnets and runtime validation.

The main contracts have no EVM/TRON payout admin. EVM recovery requires matching canonical factory deployments and pays assets on the chain where they arrived. Solana/TRON are separate rails. Zero reward means only the merchant payout; the executor still sponsors transaction costs. No customer refunds, token conversion, issuer-freeze bypass or cross-chain bridging are implemented. Fee-on-transfer/rebasing tokens are unsupported.

Superseded implementation sources have been removed; historical deployment records and funded order data remain intact. Existing addresses do not migrate to a new factory. Local validation is not an independent audit. No custody keys belong in the app or its database.
