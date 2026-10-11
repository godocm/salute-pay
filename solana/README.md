# Salute Solana main program

The merchant signs an Ed25519 intent. Merchant-bound PDAs collect SOL and classic SPL tokens to an immutable merchant, with an optional reward per sweep. SOL can be prefunded; SPL accounts require setup. Vault rent is retained for later deposits. Public deployment revokes upgrade authority before activation.

See [architecture](../docs/ARCHITECTURE.md) and [deployment](../docs/DEPLOYMENT.md). Build with Anchor, load the main program into an isolated loopback validator, then run the collection smoke and Wallet Standard tests. Tests use temporary valueless accounts. Do not reset persistent `.data` ledgers.
