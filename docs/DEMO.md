# Three-minute Salute Pay demo

Use this as a recording outline and checklist. Explain the product in your own words. Show real testnet receipts; label recorded clips and illustrations. Salute Pay is the non-custodial side project of SaluteBank.com, whose existing managed service and prior development should be disclosed separately in the submission.

## Prepare before recording

1. Open `https://salutepay.vercel.app/` in a desktop browser at 1440 × 900 or similar, with readable zoom. Close unrelated tabs and disable notifications. Never show seed phrases, private keys, database credentials or webhook secrets.
2. Prepare three separate testnet accounts: merchant, payer and executor. Each transaction sender needs network fees. Use browser profiles or carefully named wallet accounts; use a new test wallet rather than a savings wallet.
3. For the most predictable hosted walkthrough, select **Base Sepolia**: it is available on Free. Fund all three wallets with test ETH, then use **Mint test tokens** to obtain valueless sUSD for the payer. This mint is public and does not supply native gas coins. Verify the sUSD address against `/docs#deployments`.
4. If recording on Tempo, first configure a funded TIP-20 fee token with **Prepare gas token**. Hosted Tempo links require an operator-activated Growth/Scale plan. Hosted Solana links require Scale; use Devnet SOL for fees/rent and approve SPL address setup. Never imply subscription checkout is implemented. An alternative is to disable **Publish a hosted payment link** and use a signed offline link; then omit cumulative-history and webhook claims.
5. Rehearse the complete lifecycle using the intended browser wallet. This is important: local wallet-client tests do not establish compatibility with every installed wallet. WalletConnect is available only when a Reown project ID and origin allowlist are configured; the hosted demo can use an injected wallet.
6. Create a 100 sUSD invoice with a **2 sUSD reward per sweep**, public executor listing enabled, and a clear reference such as `Demo invoice 1042`. Export its signed JSON and keep the copied checkout link. Do not reuse an already funded invoice when recording the creation step.
7. For webhook footage, set your own public HTTPS endpoint in Developer settings before creating the invoice and enable its webhook checkbox. The receiver must verify HMAC over the raw body and deduplicate event IDs. Show only the event payload/status, never its signing secret. If no endpoint is ready, show integration docs and describe this as an implemented capability without claiming a demonstrated delivery.
8. Have explorer tabs ready for payer deposit and executor collection. Let the authenticated watcher finish receipt verification before recording the status segment. The scheduled watcher runs approximately every minute; RPC and confirmation delays can add time.
9. Record actual partial/late-payment footage separately for the short resilience segment. Keep the invoice, network and transaction identities consistent. Do not substitute the homepage calculator for a real settlement.

## Recording timeline — 180 seconds

### 0:00–0:20 · The merchant problem

Show the homepage and one concrete merchant scenario. Explain the difficulty of matching ordinary crypto transfers to invoices, requiring payer wallet pairing, and relying on a provider-held balance. Describe the target merchant and the problem you have personally observed. Label examples as examples; name interviews/pilots only if you have actual evidence.

### 0:20–0:45 · Merchant creates the invoice

Show `/app`, the network/testnet badge, reference, 100 sUSD invoice and 2 sUSD reward. Sign the order, then show the fixed merchant destination, unique payment link and **Export order**. Explain that EVM order creation is off-chain; no receiver deployment is paid for an unfunded order.

### 0:45–1:15 · Customer pays without connecting to Salute

Open the dedicated checkout. Leave its Salute wallet connector disconnected. Show the exact network, asset contract, address and QR code. In the payer's separate wallet, send 100 test sUSD to that address and show the confirmed transfer receipt. This demonstrates address-based payment without pairing to the site. Explain exchange withdrawals as a compatible-network use case, not an actual exchange integration in this testnet demo.

### 1:15–1:55 · Independent executor settles

Open `/executor`, select Base, refresh the queue, and choose the invoice. Alternatively import its copied hosted link or exported JSON. Connect the third wallet. Show the live available balance, fixed merchant destination and settlement review: estimated **98 sUSD merchant receipt**, **2 sUSD executor reward**. Sign and show the collection receipt/explorer. Explain that the executor pays network costs and the reward is gross compensation, not guaranteed profit.

### 1:55–2:20 · Business can verify fulfilment

Show the checkout's server-verified invoice status and collected amount after indexing catches up. Distinguish funding from collection: deposit detection alone is not a completed merchant payout. If prepared, show the matching HMAC-verified webhook at your endpoint. Briefly show the export/CLI path: the dashboard is an optional index and does not authorize fund movement.

### 2:20–2:40 · Real payment edge cases

Show a labelled recorded testnet clip of a partial 10 sUSD deposit on a 100 sUSD invoice, or a late deposit after collection. A partial balance can be collected; the invoice remains partial. Late balances can be collected again, including a sponsored sweep with no executor reward. If demonstrating excess funding, explain that excess goes to the merchant and there is no automatic customer refund. Rewards are per sweep: two rewarded sweeps deduct two rewards.

### 2:40–3:00 · What is built and why it matters

Show the verified deployments in `/docs`: eight public testnets, with Tempo and Solana primary. Connect the proof to merchant reconciliation, optional payer wallet pairing and independent collection. State the limits clearly: beta/testnet, no refunds, bridging, exchange or implemented AML; network costs remain; not independently audited. Close with the specific merchant pilot you want to run next and what feedback would validate the product.

## Edit and export

- Keep the final file at or below **3:00**. Aim for 2:50–2:55 to leave encoding/player margin. Use readable screen capture, clear audio and captions; avoid long terminal output.
- Trim waiting between wallet confirmation and verified status. Label cuts or accelerated footage; do not imply settlement/indexing was instantaneous.
- Keep the visible beta/network badge and readable addresses/receipt links. Do not display “no fees” without the network-cost/reward qualification.
- Play the final video from start to finish and test the shared link in a signed-out browser. Ensure reviewers can watch without requesting access. Fill the separate presentation/demo fields requested by the actual submission portal.
- Update the Arena draft manually: remove refunds/implemented AML, qualify recovery and costs, complete business/team fields, disclose SaluteBank development history, and submit rather than merely saving the draft. Source changes do not update or submit the Arena form.

Official references checked 12 October 2026: [submission FAQ](https://colosseum.com/hackathon), [Crypto World’s Fair rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf). Deadline: **13 October 2026, 10:59 AM Asia/Dubai** (12 October, 11:59 PM Pacific).
