# Vercel and public deployment

## What is prepared

The portal is a full-stack Next.js app: the frontend and `/api/*` backend deploy together to Vercel. PostgreSQL is the separate durable service; no VM, custody wallet or continuously running signing server is required. The testnet demo is hosted at [salutepay.vercel.app](https://salutepay.vercel.app) as of 2026-10-12, with Neon PostgreSQL and a scheduled Neon Function calling the authenticated receipt watcher/webhook endpoint.

Routes include `/` (homepage), `/chains` and eight themed `/chains/{chain}` pages, `/about`, `/docs` (verified contract addresses), merchant creation at `/app`, executor discovery/settlement at `/executor`, hosted payment pages at `/pay/{slug}`, and wallet-authenticated webhook settings at `/developer`. `/networks.html` forwards to the chain directory; `/pricing.html` and `/integration.html` remain public. Only verified deployments in `portal/public/deployments/main.json` are activated. Eight public testnets were deployed and exercised on 2026-10-11: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, BNB Testnet, Tempo Moderato, Robinhood Testnet, TRON Nile and Solana Devnet.

## Public hackathon launch, step by step

This publishes a real HTTPS application using existing **testnet** contracts and test assets. It does not deploy or activate mainnet contracts. Provider documentation was checked on 2026-10-12.

1. **Prepare the source that will actually be uploaded.** Use Node 24. The dashboard is now tracked directly under `portal/` in the parent repository, so a normal clone includes the actual Next.js implementation and ABIs. Use Vercel Root Directory `portal` for a parent-repository Git import, or run the CLI from `portal/` for the existing linked project. Verify the intended commit is pushed. Never commit keys, `.env`, `.data` or dependency trees. The previous nested Git history is retained locally in ignored `.data/portal-git-history-20261012`; it is not required to build or deploy.
2. **Create PostgreSQL.** Create a Neon project in a region near the Vercel functions. Use its pooled PostgreSQL connection string. A small demo can use Neon's Free plan, within provider quotas; free compute may sleep and introduce cold-start latency. Keep its credentials server-only. [Neon plans](https://neon.com/docs/introduction/plans), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
3. **Create the schema before enabling publication.** Copy `portal/.env.example` to ignored `portal/.env.local` and put the pooled `DATABASE_URL` there using a local editor. From the portal directory, run `node --env-file=.env.local scripts/migrate.mjs`. Node 24 loads that file for this command; the migration preserves existing records. Do not paste the database URL into chat or a command that prints it.
4. **Create a Reown project.** Obtain its public project ID and set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Add the eventual canonical HTTPS app origin to the Reown allowlist. This enables real EVM WalletConnect pairing; Solana uses Wallet Standard and TRON uses TronLink. Allowlist updates can take time to apply. [Reown project IDs and allowlists](https://docs.reown.com/cloud/relay).
5. **Deploy the entire Next.js portal.** From `portal/`, use `npx vercel` to link/preview, then `npx vercel --prod` once configuration is set. If deploying a standalone portal Git repository, choose Next.js and its root; if a correctly configured parent repository exposes the actual portal source, choose Root Directory `portal`. Use Node 24, `npm ci` and `npm run build`. Do not use a static HTML export: it would omit the authentication, publisher and job backend. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).
6. **Set the production environment.** In Vercel set `DATABASE_URL`, `APP_ORIGIN` (exact HTTPS origin, no trailing slash), `CRON_SECRET` (a fresh random secret), and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Optional `RPC_ETHEREUM`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_TEMPO`, `RPC_BNB`, `RPC_ROBINHOOD`, `RPC_SOLANA` and `RPC_TRON` overrides are server-only. Private RPC credentials stay out of the public registry. Never put deployer keys in Vercel. Redeploy after environment changes; the WalletConnect ID is compiled into the client. Use the canonical URL when logging in: an alternative preview/domain origin will fail origin-bound writes unless configured separately.
7. **Turn on the job trigger.** The default `vercel.json` has no cron, so it can deploy without an unsupported Hobby schedule. On an eligible paid plan, copy `vercel.pro.json` to `vercel.json` and redeploy to schedule `GET /api/jobs` every minute. Vercel supplies `Authorization: Bearer <CRON_SECRET>`. For an eligible non-commercial demo on Hobby, an external scheduler can call that same HTTPS endpoint every minute with that header. Do not put the secret in the URL. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
8. **Choose the scheduler with its limits in mind.** cron-job.org documents free minute-level calls and custom headers, but a 30-second request timeout. The current watcher scans RPCs sequentially and can exceed that limit; measure its hosted duration before depending on that option. For predictable operation, use the eligible Vercel minute cron or an authenticated scheduler with an adequate timeout. The current prototype has bounded watcher/webhook queues; watch RPC errors and backlogs. Never rely on a browser tab or `setInterval` to keep jobs running. [External scheduler FAQ](https://cron-job.org/en/faq/).
9. **Make the judge’s intended network available.** The Free dashboard plan allows Ethereum/Base/Arbitrum publication. Tempo/BNB/Robinhood require operator-granted Growth ($49) or Scale ($99); Solana/TRON require Scale ($99). For a funded demo merchant, run the operator-only `plan:set` command described below after the wallet has authenticated once. A manual demo grant is not a paid subscription sale. A separate executor needs no merchant publishing upgrade to settle a valid exported order.
10. **Verify the hosted lifecycle before recording.** On the canonical URL, confirm `/api/networks` lists exactly eight ready testnets and `databaseConfigured: true`. Pair an actual external wallet; sign in, save a webhook endpoint, publish an order and open its `/pay/{slug}` link in a separate browser. Fund with test assets, settle from a different executor wallet and check the merchant’s chain receipt. Confirm the authenticated job returns success, receipt-derived events arrive with valid HMAC, and duplicate event IDs are safe. Test partial/excess funding, a late second collection and zero reward; retain explorer evidence. Recheck wrong-chain EVM recovery with the exported original order if demonstrating it. A normal unauthenticated `/api/jobs` request must return 401.
11. **Keep the demo independently usable.** Ensure judges can access the live homepage, docs, payment link and code without your local machine or private sign-in. Payment pages must use the exact intended testnet, asset and derived address. Export signed order data so an independent executor does not need a live dashboard to obtain authorization. Keep test-token mint controls labelled; native gas comes from network faucets, not the mint button.

Vercel Hobby is restricted to personal, non-commercial use. A Salute Bank commercial merchant service needs an eligible plan; a free PostgreSQL database does not remove that hosting condition. [Vercel Hobby terms](https://vercel.com/docs/plans/hobby).

## Hosted testnet configuration

The Vercel project is `salutepay`. The Neon Free project is `salute-pay-testnet-demo` in Frankfurt, using PostgreSQL 16. The schema was migrated before publication. `DATABASE_URL` and `CRON_SECRET` are encrypted production environment variables; `APP_ORIGIN` is `https://salutepay.vercel.app`. Deployer keys are never uploaded. Node 24 is pinned in the portal manifest, and `.vercelignore` excludes secrets, test files and local execution state.

Set the server-only `RPC_BASE` to `https://base-sepolia-rpc.publicnode.com` for the current watcher. The official `sepolia.base.org` endpoint limits log requests to 200 blocks, while this watcher scans ranges up to 2,000 blocks. The replacement endpoint's chain ID, factory and full log range were checked before configuration. Recheck provider limits when changing RPCs.

The `salutejobs` Neon Function runs `scripts/neon-jobs-function.mjs` from an archive whose entry is named `index.mjs`. Its environment contains only the app origin and job secret. The `salute-payment-watcher` trigger invokes it every minute. Neon strips client-provided `X-Neon-*` headers; the handler requires the platform's trigger header before forwarding an authenticated request. Redirects are rejected, calls time out after four minutes, and watcher errors are reported in its logs. [Neon deployment format](https://neon.com/docs/compute/functions/deploy), [scheduled trigger authentication and configuration](https://neon.com/docs/compute/functions/triggers/schedule).

Vercel Hobby's native cron remains disabled. Neon currently includes 1 GB of database storage and 100 CU-hours per project monthly on Free; frequent jobs can keep database compute awake and exhaust that allowance. Monitor compute, function usage, storage and RPC quotas. This configuration supports a bounded testnet demo, not a promise of continuously free commercial infrastructure. [Neon Free allowances updated 2026-10-02](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Vercel Hobby eligibility](https://vercel.com/docs/plans/hobby).

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` still needs a Reown project ID and origin allowlist for WalletConnect pairing. Injected browser wallets use their existing connectors. Operator plan grants are required to publish on networks outside the app's Free plan; these grants do not charge a subscription.

Fresh live transaction results for all eight testnets, with explorer links, are in `deployments/runs/2026-10-12/results.json`. Previous evidence is preserved in the same directory. Testnet smoke tests do not establish mainnet readiness or replace an independent review.

## Mainnet production steps

1. Freeze the intended protocol behavior and have the EVM, TRON and Solana implementations independently reviewed. Address findings and repeat the invariant, CLI, wallet and platform checks. Define the supported standard transferable assets and disclose the existing limits on refunds, cancellation, bridging and exchange.
2. Add explicit mainnet configuration and activation verification. The current public registry and wallet defaults describe testnets; Solana deployment/publication and TRON deployment scripts have testnet guards, and activation currently writes `environment: testnet`. A change of RPC URL alone does not produce a mainnet product. Preserve old funded orders, addresses and deployment records.
3. Prepare reviewed mainnet artifacts and supported real asset addresses. Exclude demo issuance from the production rollout. Use a mainnet-specific Solana genesis/domain, verify deployed program bytes, then revoke upgrade authority before activation. For EVM, verify the canonical proxy, factory and implementation identities on each network. For TRON, verify its own chain/domain and TVM deployment evidence. Mainnet deployment spends real fees and needs a separately authorized, funded deployer.
4. Use hosting eligible for commercial activity, durable PostgreSQL with backups and restore drills, and reliable server RPCs. Configure the canonical origin, TLS, encrypted secrets and Reown allowlist. Keep all fund authorization in merchant/customer wallets, with no production signing service or custody keys.
5. Run the watcher reliably and monitor each chain's RPC failures, confirmation policy, indexing lag and webhook retries. Scale the prototype's bounded queues and event discovery before substantial volume. TRON receipts from independent executors currently need submission to the verification endpoint; automatic discovery requires a full event indexer. Implement actual billing if selling subscriptions and staff any advertised support.
6. Test a hosted mainnet pilot with small amounts, separate payer/merchant/executor wallets and verified receipts. Exercise partial, excess and late balances, zero rewards and recovery. Confirm webhook HMAC/deduplication, recovery after downtime and exports of signed orders. Expand only after pilot accounting and operational checks pass.

## Submission readiness

The code and hosted testnet deployments form a technical prototype. Cloud configuration, scheduled job calls and a hosted Base payment lifecycle have passed automated checks. Actual third-party wallet pairing, subscription charging, staffed support and mainnet operations remain launch work.

For Crypto World's Fair, the official deadline is **2026-10-13 10:59 Asia/Dubai** (2026-10-12 23:59 Pacific). Each teammate must register and the team leader must submit before it; only one team/product per individual is allowed. [Official event rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf).

The FAQ lists both a 2–3 minute presentation and a product demo no longer than 3 minutes, a reviewable repository, team details, a logo, and evidence supporting demand/distribution and business viability. Prepare both video fields if the live portal requests them. Disclose pre-existing Salute Bank work and identify what Salute Pay added during the event. Do not label internal company transaction volume as Salute Pay customer traction. The current draft has live-product/repository links but still needs its final presentation/demo links and complete business/team answers. Remove implemented refunds/AML claims, qualify costs and deposit-chain recovery, include Arbitrum in the chain explanation, and use “SPL tokens.” Source changes do not edit or submit the Arena form. [Submission FAQ](https://colosseum.com/hackathon#h-faq-11), [development-history FAQ](https://colosseum.com/hackathon#h-faq-4).

The largest non-technical gap is still demand validation: a recorded merchant interview, a test integration or specific pilot interest supports the buyer story better than more chains. Present evidence in your own words, and distinguish prototypes, measured results and future plans.

## Run locally

Use Node 24. Run `npm install`, `npm --prefix portal install`, `npm --prefix tron install`, and `npm --prefix solana install`. `npm run build` compiles EVM/TRON, exports the main ABIs and builds the portal. `npm run dev` serves loopback port 5173. Keep `.data` intact. No lab signing server is used.

Copy `portal/.env.example` into an ignored `portal/.env.local` and configure server-only `DATABASE_URL`, `APP_ORIGIN`, `CRON_SECRET`, plus public `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Never put wallet keys or database credentials in `NEXT_PUBLIC_` variables. For migration from a shell, explicitly supply DATABASE_URL to `npm --prefix portal run db:migrate`; the standalone CLI does not read Next's `.env.local` automatically. The migration creates tables without deleting existing records.

## PostgreSQL on Neon

Create a PostgreSQL database and use its pooled connection string as `DATABASE_URL`. Run the migration against it. A small prototype can fit a free database plan, subject to current limits. Do not put a SQLite file on Vercel's filesystem: it is not a durable, shared database. Do not expose the database through a public browser credential. Configure backups/retention appropriate to the service before production.

Neon lists a Free plan; check [Neon's pricing](https://neon.com/pricing) and [free-plan guide](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan) for current allowances. Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) restricts commercial use to personal/non-commercial projects. A commercial merchant service needs an eligible hosting plan; a free database does not make all infrastructure free.

## Vercel

1. Import the `portal` repository/directory with Root Directory `portal` when deploying the parent repository, or use the root of the portal's own repository. Framework preset is Next.js; build command `npm run build` and install command `npm ci`. Compiled protocol ABIs are tracked in the portal so Vercel does not need Rust, TRONBox or the parent contract checkout.
2. Set `DATABASE_URL`, `APP_ORIGIN` to the deployed canonical HTTPS origin, `CRON_SECRET` and the WalletConnect project ID. Allowlist the actual origin in Reown. RPC overrides such as `RPC_SOLANA` or `RPC_TEMPO` are server-only; public wallet RPCs remain non-secret defaults.
3. Run the PostgreSQL migration before accepting links. Verify `/api/networks`, merchant login, separate payment pages and webhook receipt/signature processing.
4. The default `vercel.json` does not schedule jobs. The optional `vercel.pro.json` schedules `/api/jobs` every minute when copied to `vercel.json`, requiring an eligible Vercel plan. Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Alternatively have an external authenticated scheduler call the endpoint. Daily Hobby cron is insufficient for a timely payment service. Do not rely on an in-process interval in a serverless function.
5. Check watcher error counts, indexing backlog, dead webhook jobs and provider quotas. Set transaction confirmation policies per network and reconcile receipts before fulfilment. The first watcher is a bounded prototype, not a replacement for a high-volume production indexer.

## Main chain deployments

Only explicit `--broadcast` sends transactions. Compile first. All public deployment scripts require public HTTPS RPC identity checks and preserve pending checkpoints.

EVM: `node scripts/deploy-collection.mjs` with `RPC_URL` and `EXPECTED_CHAIN_ID` is a dry run. The same pinned deterministic proxy must already exist. Broadcasting additionally needs a funded deployer `PRIVATE_KEY`; configure Tempo fee-token preference before using its deployer. The checkpoint is created exclusively; do not delete pending state to force a retry. Existing verified factories are reused without token issuance. Use `DEPLOY_OUTPUT` for a specific checkpoint. After runtime verification, activate the network with `DEPLOY_CHAIN=<chain> RPC_URL=<rpc> node scripts/activate-network.mjs <checkpoint>`.

Batch testnets: `npm run deploy:testnets -- --networks tempo,solana` reads ignored root `.env`. It preflights selected networks first; explicit `--broadcast` performs deployments. EVM keys use `<CHAIN>_DEPLOYER_PRIVATE_KEY`, RPC overrides `<CHAIN>_RPC_URL` and optional payment token `<CHAIN>_PAYMENT_TOKEN`. Non-EVM scripts perform their own complete preflight and checkpointing. No automatic retry remints tokens.

Solana: `node solana/scripts/deploy.mjs` uses `SOLANA_DEPLOYER_KEYPAIR_PATH`, `SOLANA_PROGRAM_KEYPAIR_PATH`, `MERCHANT_ADDRESS`, optional `SOLANA_RPC_URL` and `DEPLOY_OUTPUT`. It builds a domain-bound new program in an isolated directory and checks rent/funding. Broadcasting deploys, irrevocably revokes upgrade authority, then creates the test mint. That revocation is intentional for immutable payment infrastructure. Inspect an incomplete checkpoint, then use `--resume` with the same program and deployer configuration. The uploader uses TPU transport; existing buffers and pending mint transactions are preserved. A complete checkpoint exits without reminting. Program bytes must match the prepared binary before revoking authority. Activation verifies Devnet genesis, executable program, revoked authority and the simulated network domain. Local test validators load the compiled program directly and are not public deployments.

TRON: `node tron/scripts/deploy.cjs` uses `TRON_DEPLOYER_PRIVATE_KEY`, `MERCHANT_ADDRESS`, `TRON_FULL_NODE_URL`, `TRON_CHAIN_ID` and optional `DEPLOY_OUTPUT`. Only explicit `--broadcast` deploys and creates the dummy test token. Activation verifies its chain and signature domain. Use Nile/Shasta test assets, never real customer balances during development.

`activate-network.mjs` writes only non-secret public deployment metadata to `portal/public/deployments/main.json`. Keep previous public deployment records and `.data` history. New main checkout links are incompatible with old contracts; do not rewrite a funded order's terms or deposit address.

## Plans and operational support

Pricing pages and server quotas are implemented. Subscription charging is not: grant a paid plan after separately verified billing with `DATABASE_URL=... npm --prefix portal run plan:set -- evm:0x... growth` (or `scale`). For Solana/TRON use their canonical wallet-family IDs. Users cannot grant their own plan. Do not promise staffed 24/7 support until your team supplies it.

## Checks

- `npm test`: main EVM/CLI/adversarial tests, cross-chain addressing, rewards and gas comparisons.
- `npm run test:wallet:ethereum`: isolated Ganache wallet client.
- `npm run tempo:test` and `npm run test:wallet:tempo`: actual loopback Tempo runtime, port 18549.
- Build the Solana main program with Anchor, load it into an isolated validator on loopback 29999, then `npm run solana:smoke` and `npm run test:wallet:solana`.
- `npm run tron:test`: named isolated TRE fixture `salute-tron-main-test` on loopback 9091.
- `npm run test:platform`: named isolated local PostgreSQL instance on 15432, database `salute_test`; the test creates and drops its own temporary schema only.
- `npm run build`; `cd portal && npx tsc --noEmit`.

Real WalletConnect pairing requires a configured Reown project ID and a compatible wallet. Local wallet tests use public/temporary test accounts and exercise the same client flows; they do not prove every third-party wallet supports every emerging chain.

## Public deployment and smoke commands

`node scripts/deploy-public-testnets.mjs --broadcast` checks each EVM target independently, skips unfunded chains and reuses verified checkpoints. It creates freely mintable test sUSD; Tempo uses a public issuance wrapper with a dedicated issuer role. `node scripts/test-public-testnets.mjs --broadcast` sends testnet transactions and records receipts in `deployments/testnet-validation.json`. It is never part of `npm test`. Public wallet client and TRON checks similarly require explicit broadcast flags. Select EVM deployments with `--networks base,bnb`; other network records remain intact. `node scripts/test-public-recovery.mjs --networks base,bnb --broadcast` checks unchanged Ethereum-origin orders on those deposit chains. `node scripts/test-public-wallet-client.mjs solana --broadcast` checks the deployed Devnet program through the app client. All public test receipts are saved under `deployments/`.

The merchant **Mint test tokens** button issues 1,000 valueless payment tokens to the connected wallet on the selected activated network. It cannot mint native gas coins. Solana's test mint is assigned to a separate program PDA; anyone can call the capped mint instruction for their own token account. This PDA cannot sign for payment vaults. The faucet is exercised on the deployed Devnet program through the same app wallet-client method as the button.

## Prepare Solana keypairs before deployment

These are two separate keypairs. The deployer pays Devnet fees/rent; the fresh program keypair determines the program's address. Generate both before deployment, never after. Do not use the local fixture keys or a mainnet savings wallet.

```sh
mkdir -p .data/solana
chmod 700 .data/solana
solana-keygen new --outfile .data/solana/deployer.json
solana-keygen new --outfile .data/solana/program.json
solana-keygen pubkey .data/solana/deployer.json
solana-keygen pubkey .data/solana/program.json
solana airdrop 2 --url devnet --keypair .data/solana/deployer.json
solana balance --url devnet --keypair .data/solana/deployer.json
```

Store seed phrases safely; do not paste them in chat. Faucet availability and deployment rent vary: use the deploy script's preflight balance check, not the illustrative 2 SOL request, to determine required funding. Set absolute `SOLANA_DEPLOYER_KEYPAIR_PATH` and `SOLANA_PROGRAM_KEYPAIR_PATH` in ignored root `.env`, along with your public `SOLANA_MERCHANT_ADDRESS`. This repository intentionally revokes program upgrade authority after deployment. Preserve the program keypair and checkpoints; do not regenerate it to retry a pending deployment.
