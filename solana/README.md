# Solana local prototype

This Anchor program supports native SOL and classic SPL token invoices on a local validator. It has no deposit private keys. The merchant signs registration, a customer funds a unique vault or vault ATA, and any funded executor can settle. Order state remains on chain; the read-only observer derives balances and transaction steps from RPC.

## Run locally

Install Rust, Solana CLI, Anchor 1.2.0, root and `solana/` npm dependencies. Run these commands from the repository root. Keep `.data/` across runs; it holds local test state and keys.

```sh
mkdir -p .data/solana
solana-test-validator --ledger .data/solana/test-ledger --rpc-port 8899 --faucet-port 9900
```

In a second terminal, on first setup only:

```sh
solana-keygen new --no-bip39-passphrase --outfile .data/solana/merchant-keypair.json
solana-keygen new --no-bip39-passphrase --outfile .data/solana/program-keypair.json
cd solana && anchor build --ignore-keys && cd ..
cp .data/solana/program-keypair.json solana/target/deploy/salute_pay-keypair.json
cd solana && anchor keys sync && anchor build && cd ..
```

For each fresh validator ledger, airdrop and deploy the program:

```sh
solana airdrop 20 "$(solana address -k .data/solana/merchant-keypair.json)" --url http://127.0.0.1:8899
solana program deploy solana/target/deploy/salute_pay.so --program-id .data/solana/program-keypair.json --keypair .data/solana/merchant-keypair.json --url http://127.0.0.1:8899
npm run solana:smoke
npm run solana:observe
```

Open the existing portal at `http://localhost:5173/solana`. The smoke script registers SOL and SPL orders, funds them from a separate payer, settles from a separate executor, tests partial funding and payout redirection, and sweeps late funds. The observer listens only on `127.0.0.1:8790` and has no signing key. Its `GET /api/solana/orders` response includes status, verified balance, addresses, terms and a chain-derived transaction timeline.

## Chain flow and limits

This implementation uses registration, deposit and settlement: three transactions. That is an implementation choice, not a Solana requirement. A redesigned SOL path can accept a deposit at a bare PDA and create the settlement state in the executor's transaction, provided every order term is bound to the address. A self-custody SPL payer can create the vault ATA and transfer in one deposit transaction; an exchange withdrawal may need the ATA prepared beforehand. SOL vault rent stays locked to allow late deposits. SPL ATA rent also stays funded. Any executor with SOL for network fees can submit settlement. If no executor acts, funds remain in the vault. Current prototype has no refund or wrong-asset recovery. Binance and other exchange withdrawal forms may reject off-curve PDA-related addresses; a small withdrawal of the exact network and asset must be tested before offering that route.

Do not use the local merchant or program keys on a public network. The local program retains upgrade authority for development. A public release needs independent review and a final immutable deployment before claiming that an upgrade cannot change vault rules.
