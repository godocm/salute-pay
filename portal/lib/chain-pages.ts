// Network facts checked against the linked primary sources on 2026-10-12.
// Use cases are examples, not claims of existing merchant adoption.
export type ChainPage = {
  id: string;
  name: string;
  theme: string;
  category: string;
  title: string;
  intro: string;
  highlight: string;
  highlightDetail: string;
  useCase: string;
  useCaseDetail: string;
  gas: string;
  authorization: string;
  address: string;
  testnet: string;
  steps: { title: string; body: string; actor: string }[];
  notes: string[];
  sources: { title: string; url: string }[];
};
const evmSteps = (network: string, gas: string): ChainPage["steps"] => [
  {
    title: "Create & sign",
    actor: "Merchant · Off-chain",
    body: `Choose ${network}, a supported asset, invoice expectation and bounded reward. Sign the EIP-712 order; its merchant destination and original terms are fixed.`,
  },
  {
    title: "Fund the address",
    actor: "Customer · On-chain",
    body: `Send the selected asset on ${network} to the order’s predicted address. There is no receiver deployment at order creation, and the payer does not sign the merchant’s order.`,
  },
  {
    title: "Deploy & collect",
    actor: "Executor · On-chain",
    body: `Any executor with the signed order can pay ${gas} transaction fees. The factory verifies authorization and deploys the receiver with its initial collection atomically.`,
  },
  {
    title: "Receive & reconcile",
    actor: "Merchant · Same network",
    body: `The balance goes to the signed merchant on ${network}, less the authorized reward. Partial, excess and late balances remain collectable; invoice status is tracked separately.`,
  },
];
export const chainPages: ChainPage[] = [
  {
    id: "tempo",
    name: "Tempo",
    theme: "tempo",
    category: "Payment-focused EVM",
    title: "Stablecoin payments. Stablecoin gas.",
    intro:
      "Collect stablecoin invoices with a payment rail designed around stablecoins, including the asset used to pay transaction fees.",
    highlight: "No separate native gas token",
    highlightDetail:
      "Tempo has no native token. Supported USD-denominated TIP-20 stablecoins can cover transaction fees, including priority fees.",
    useCase: "Supplier invoices priced in stablecoins",
    useCaseDetail:
      "A business collecting USD-denominated invoices can use a supported stablecoin fee asset instead of maintaining a separate volatile gas-token balance. Salute supplies the signed order and collection flow.",
    gas: "Supported USD TIP-20",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "Tempo Moderato",
    steps: [
      {
        title: "Sign a TIP-20 order",
        actor: "Merchant · Off-chain",
        body: "Choose a transferable TIP-20 payment token, invoice expectation and reward. The EIP-712 signature fixes the original terms and merchant destination.",
      },
      {
        title: "Fund the receiver",
        actor: "Customer · On-chain",
        body: "Send the intended TIP-20 token to the predicted receiver on Tempo. Creating an order requires no receiver deployment.",
      },
      {
        title: "Select gas & collect",
        actor: "Executor · On-chain",
        body: "Configure an accepted, funded fee-token preference. Any executor can call the factory to deploy the receiver and make the initial collection atomically.",
      },
      {
        title: "Receive stablecoins",
        actor: "Merchant · Tempo",
        body: "The signed merchant receives the actual collected balance less the authorized reward. Exact recipient balance checks reject issuer-policy redirection.",
      },
    ],
    notes: [
      "Gas eligibility requires a USD-denominated native TIP-20 with sufficient Fee AMM liquidity. Not every token is a fee asset.",
      "Salute’s Tempo rail supports transferable TIP-20 payments, not native-currency payments. Frozen or restricted transfers can revert.",
      "Stablecoin fees are still fees. Salute neither bridges nor exchanges payment or gas assets.",
    ],
    sources: [
      {
        title: "Tempo fee mechanics",
        url: "https://tempo.xyz/developers/docs/protocol/fees",
      },
    ],
  },
  {
    id: "solana",
    name: "Solana",
    theme: "solana",
    category: "SOL & classic SPL",
    title: "Fast checkout. Native settlement.",
    intro:
      "One immutable program handles merchant-bound payment vaults. Native SOL and SPL tokens each follow their own account lifecycle.",
    highlight: "A separate fee payer",
    highlightDetail:
      "Solana transactions can bundle instructions atomically and name a fee payer. An executor can pay collection fees while the payment asset goes to the merchant.",
    useCase: "Frequent purchases & digital services",
    useCaseDetail:
      "For customers already using Solana, payment links can serve repeated purchases without sending their assets through another network. Executors or merchants can sponsor collection fees.",
    gas: "SOL + account rent",
    authorization: "Ed25519",
    address: "Merchant-bound PDA / token account",
    testnet: "Solana Devnet",
    steps: [
      {
        title: "Sign the order",
        actor: "Merchant · Off-chain",
        body: "Sign an Ed25519 message binding the program, network domain and order terms. The program derives the merchant-bound order and vault PDAs.",
      },
      {
        title: "Prepare the deposit path",
        actor: "Merchant / Customer",
        body: "Native SOL can prefund the vault when rent requirements are met. For SPL, the merchant registers the order and sponsors creation of its associated token account before sharing the address.",
      },
      {
        title: "Deposit & collect",
        actor: "Customer → Executor",
        body: "The customer deposits SOL or funds the prepared SPL account. Any executor submits the signed authorization. Native SOL can register and collect atomically; SPL collects from the prepared account.",
      },
      {
        title: "Pay & retain the vault",
        actor: "Merchant · Solana",
        body: "The program pays the merchant and authorized reward, retaining the vault reserve for late deposits. Zero reward or sponsored collection makes only the merchant payout.",
      },
    ],
    notes: [
      "SPL setup precedes funding and needs separately sponsored rent. This is an extra step compared with a rent-eligible native SOL prefund.",
      "Transaction fees remain SOL-denominated even when another party sponsors them. Fast confirmation is distinct from finality.",
      "The deployed Salute Devnet program’s upgrade authority is revoked. Classic transferable SPL assets are supported; arbitrary token extensions are not promised.",
    ],
    sources: [
      {
        title: "Solana payment mechanics",
        url: "https://solana.com/docs/payments/how-payments-work",
      },
      { title: "Solana token accounts", url: "https://solana.com/docs/tokens" },
      {
        title: "Fee abstraction",
        url: "https://solana.com/docs/payments/send-payments/payment-processing/fee-abstraction",
      },
    ],
  },
  {
    id: "tron",
    name: "TRON",
    theme: "tron",
    category: "Native TVM rail",
    title: "Meet your TRC-20 customers.",
    intro:
      "Collect on the network where your customers already hold TRX or transferable TRC-20 assets, with a dedicated TRON payment factory.",
    highlight: "Bandwidth & Energy",
    highlightDetail:
      "TRON meters transaction size with Bandwidth and contract computation with Energy. Network resources can be staked or delegated; insufficient resources can consume TRX.",
    useCase: "Exchange-funded TRC-20 invoices",
    useCaseDetail:
      "A merchant can offer an order address to customers withdrawing supported TRC-20 assets from an exchange. Reconcile the receiving address rather than treating the exchange’s sending address as the customer.",
    gas: "Bandwidth / Energy / TRX",
    authorization: "TIP-712",
    address: "TVM-derived receiver",
    testnet: "TRON Nile",
    steps: [
      {
        title: "Sign on TRON",
        actor: "Merchant · Off-chain",
        body: "Set the TRX or supported TRC-20 terms and sign TIP-712 authorization. TRON has its own signature domain and TVM address derivation.",
      },
      {
        title: "Fund the order",
        actor: "Customer · On-chain",
        body: "Send the selected asset on TRON to the derived payment address. An exchange withdrawal is possible when the exchange supports the exact network and asset.",
      },
      {
        title: "Supply resources & collect",
        actor: "Executor · On-chain",
        body: "Any executor with the signed order supplies resources or TRX fees. The dedicated factory verifies authorization, deploys the receiver and performs its initial collection.",
      },
      {
        title: "Settle on TRON",
        actor: "Merchant · TRON",
        body: "The actual balance reaches the immutable merchant destination minus the authorized reward. Later deposits remain collectable; sponsored collection waives the reward.",
      },
    ],
    notes: [
      "Energy is not Ethereum gas. Resource availability and actual TRX expenditure must be evaluated together.",
      "Resource delegation is a TRON capability, not an automatically included Salute delegation service.",
      "TRON deposit addresses do not match EVM addresses. No bridge, exchange or automatic customer refund is included.",
    ],
    sources: [
      {
        title: "TRON Bandwidth & Energy",
        url: "https://developers.tron.network/docs/bandwidth-and-energy",
      },
    ],
  },
  {
    id: "ethereum",
    name: "Ethereum",
    theme: "ethereum",
    category: "Ethereum base layer",
    title: "Direct base-layer collection.",
    intro:
      "Use Ethereum’s native execution environment for payments in ETH or standard transferable ERC-20 tokens.",
    highlight: "Settle where the treasury is",
    highlightDetail:
      "Salute’s Ethereum collection executes directly on the base layer using familiar EVM tooling, rather than an L2 sequencer path.",
    useCase: "Higher-value treasury invoices",
    useCaseDetail:
      "When a business and its customer already hold assets on Ethereum, a direct invoice avoids requiring a move to another network merely to pay. Quote rewards with Ethereum execution costs in mind.",
    gas: "ETH",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "Ethereum Sepolia",
    steps: evmSteps("Ethereum", "ETH"),
    notes: [
      "Gas fees are ETH-denominated and congestion-sensitive. A fixed reward can become uneconomical for an executor.",
      "EIP-712 invoice amount is an expectation, not a collection cap. Excess balances go to the signed merchant.",
      "A zero-reward collection still requires someone to pay network fees.",
    ],
    sources: [
      {
        title: "Ethereum gas & fees",
        url: "https://ethereum.org/en/developers/docs/gas/",
      },
    ],
  },
  {
    id: "base",
    name: "Base",
    theme: "base",
    category: "Ethereum layer 2",
    title: "An onchain commerce rail.",
    intro:
      "Bring the same signed-order experience to customers and applications holding assets on Base.",
    highlight: "Ethereum tooling on an L2",
    highlightDetail:
      "Base is an Ethereum layer 2. Salute keeps its deterministic receiver and EIP-712 collection model while executing on Base.",
    useCase: "Everyday purchases in Base apps",
    useCaseDetail:
      "Developers can attach a payment link to their Base app or store so customers pay on the network they already use. There is no mandatory conversion to another chain’s asset.",
    gas: "ETH · L2 + L1 component",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "Base Sepolia",
    steps: evmSteps("Base", "ETH"),
    notes: [
      "Estimate both L2 execution and the L1 data/security fee component; do not quote execution gas alone as the full fee.",
      "Collection pays the merchant on Base. It does not withdraw assets to Ethereum.",
      "Using Base does not grant access to Coinbase accounts, automatic refunds or sponsored gas.",
    ],
    sources: [
      { title: "Base overview", url: "https://docs.base.org/get-started/base" },
      {
        title: "Base network fees",
        url: "https://docs.base.org/specifications/transactions/network-fees",
      },
    ],
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    theme: "arbitrum",
    category: "Nitro Ethereum L2",
    title: "Collect from L2 treasuries.",
    intro:
      "Invoice businesses and users on Arbitrum with network-native collection and the same portable Salute order format.",
    highlight: "Nitro execution",
    highlightDetail:
      "Arbitrum Nitro supports EVM execution with costs for L2 computation and parent-chain data posting.",
    useCase: "B2B services paid by Arbitrum teams",
    useCaseDetail:
      "An agency or developer can invoice a team whose treasury is already on Arbitrum, letting the team pay there rather than move funds to a different network for checkout.",
    gas: "ETH · computation + data",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "Arbitrum Sepolia",
    steps: evmSteps("Arbitrum", "ETH"),
    notes: [
      "Rewards must account for variable parent-chain data costs as well as computation.",
      "Merchant collection on Arbitrum is distinct from an L2-to-L1 bridge withdrawal.",
      "Compatible wrong-chain EVM recovery requires matching canonical deployment identities and preserves the original signed terms.",
    ],
    sources: [
      {
        title: "Inside Arbitrum Nitro",
        url: "https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro",
      },
      {
        title: "Arbitrum fee mechanics",
        url: "https://docs.arbitrum.io/build-decentralized-apps/troubleshooting-building",
      },
    ],
  },
  {
    id: "bnb",
    name: "BNB Chain",
    theme: "bnb",
    category: "BNB Smart Chain",
    title: "Checkout for BSC-native users.",
    intro:
      "Offer payments on BNB Smart Chain for customers already using its wallets, tokens and supported exchange withdrawal routes.",
    highlight: "EVM compatibility, BNB gas",
    highlightDetail:
      "BNB Smart Chain supports EVM contracts and Fast Finality. Salute’s signed-order lifecycle runs on BSC, using BNB for gas.",
    useCase: "Stores serving BSC wallet customers",
    useCaseDetail:
      "Customers can use the BSC assets they already hold or withdraw the supported asset over the exact BSC route. The merchant receives those assets on BSC.",
    gas: "BNB",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "BNB Testnet",
    steps: evmSteps("BNB Smart Chain", "BNB"),
    notes: [
      "This integration targets BNB Smart Chain, not every chain in the BNB ecosystem.",
      "Fast Finality can fall back to probabilistic finality. Check finalized state and confirmation policy before fulfilment.",
      "An exchange’s withdrawal fee or minimum can change what reaches the order address. Reconcile actual deposits.",
    ],
    sources: [
      {
        title: "BNB Smart Chain introduction",
        url: "https://docs.bnbchain.org/bnb-smart-chain/introduction/",
      },
      {
        title: "BSC finality API",
        url: "https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/",
      },
    ],
  },
  {
    id: "robinhood",
    name: "Robinhood Chain",
    theme: "robinhood",
    category: "Financial ecosystem L2",
    title: "Payment rails for financial apps.",
    intro:
      "Explore a Salute integration on Robinhood Chain, an EVM-compatible financial ecosystem built with Arbitrum Nitro.",
    highlight: "A financial-app ecosystem",
    highlightDetail:
      "Robinhood Chain combines Nitro infrastructure and ETH gas with a focus on onchain financial assets. Salute currently integrates its public testnet.",
    useCase: "Services for chain-native applications",
    useCaseDetail:
      "A developer building services for this ecosystem can prototype invoices and merchant collections using the same Salute integration. This is an example application, not a Robinhood partnership.",
    gas: "ETH",
    authorization: "EIP-712",
    address: "Deterministic EVM receiver",
    testnet: "Robinhood Testnet",
    steps: evmSteps("Robinhood Chain Testnet", "ETH"),
    notes: [
      "Salute’s deployed integration is on testnet chain ID 46630. Robinhood’s official docs also list a separate mainnet; Salute has not activated it.",
      "No brokerage-account access, stock-token support or ability to bypass issuer transfer rules is implied.",
      "Only standard transferable assets supported by the protocol can be collected. This integration does not bridge funds.",
    ],
    sources: [
      {
        title: "Robinhood network details",
        url: "https://docs.robinhood.com/chain/add-network-to-wallet/",
      },
      {
        title: "Robinhood Chain availability",
        url: "https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/",
      },
      {
        title: "Robinhood Nitro infrastructure",
        url: "https://docs.robinhood.com/chain/run-a-full-node/",
      },
    ],
  },
];
export const chainPage = (id: string) => chainPages.find((c) => c.id === id);
