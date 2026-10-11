# Salute TRON main factory

TIP-712 signed orders use the TVM-specific deterministic address. Any executor can collect partial/excess balances, wrong assets and later deposits to the immutable merchant. Intended-asset rewards apply per sweep; zero reward and sponsorship omit executor payout.

See [architecture](../docs/ARCHITECTURE.md) and [deployment](../docs/DEPLOYMENT.md). `tronbox compile --all` compiles main contracts. Runtime tests use only the named isolated TRE fixture on loopback 9091, never public-chain keys or transactions. Keep `.data` history intact.
