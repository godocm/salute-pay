import "./browser-buffer";
import { Buffer } from "buffer";
import nacl from "tweetnacl";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  hexlify,
  parseUnits,
  randomBytes,
} from "ethers";
import protocol from "./protocol.json";
import deploymentRegistry from "../public/deployments/main.json";
import { solMessage, solAddresses } from "./payment-model";
import { verifyDeployment } from "./collection";
import { PORTABLE_COLLECTION_FACTORY_ABI } from "./collection-abi";
import {
  connectSolana,
  currentSolana,
  connectTron,
  walletConnectProvider,
  disconnectWallet,
  walletOptions,
  setSolanaChain,
  activeWalletConnectProvider,
} from "./wallet-connectors";
export { disconnectWallet, walletOptions };
import evmNetworks from "./evm-networks.json";
import { rememberWalletConnector, walletConnector } from "./wallet-session";
export { evmNetworks };
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { TronWeb } from "tronweb";

export type EvmChain = keyof typeof evmNetworks;
export type Chain = "solana" | EvmChain | "tron";
export const chains: Chain[] = [
  "solana",
  "ethereum",
  "base",
  "arbitrum",
  "tempo",
  "robinhood",
  "tron",
  "bnb",
];
export const isEvm = (chain: Chain): chain is EvmChain =>
  Object.hasOwn(evmNetworks, chain);
export const gasAsset = (chain: Chain) =>
  isEvm(chain) ? evmNetworks[chain].gas : chain === "solana" ? "SOL" : "TRX";
export type Network = {
  chain: Chain;
  rpc: string;
  chainId: string;
  deployment: string;
  token: string;
  domain: string;
  feeToken?: string;
  faucet?: string;
  environment?: string;
};
export type Terms = {
  id: string;
  merchant: string;
  token: string;
  amount: string;
  executorFee: string;
  originChainId?: string;
};
export type Receipt = {
  kind: string;
  hash: string;
  status: "pending" | "confirmed" | "failed" | "replaced";
  at: string;
  received?: string;
  merchantAmount?: string;
  reward?: string;
  chain?: Chain;
};
export type Intent = {
  version: 4;
  network: Omit<Network, "rpc">;
  terms: Terms;
  address: string;
  signature: string;
  reference: string;
  asset: string;
  decimals: number;
  createdAt: string;
  balance: string;
  settled: boolean;
  verifiedAt?: string;
  slug?: string;
  webhookEnabled?: boolean;
  publicListing?: boolean;
  collected?: string;
  received?: string;
  receipts: Receipt[];
};
export const defaults: Record<Chain, Network> = {
  solana: {
    chain: "solana",
    rpc: "https://api.devnet.solana.com",
    chainId: "devnet",
    deployment: "",
    token: "",
    domain: "",
  },
  ...(Object.fromEntries(
    Object.entries(evmNetworks).map(([chain, c]) => [
      chain,
      {
        chain,
        rpc: c.rpc,
        chainId: c.chainId,
        deployment: "",
        token: "",
        domain: "",
        feeToken: "feeToken" in c ? c.feeToken : undefined,
      },
    ]),
  ) as Record<EvmChain, Network>),
  tron: {
    chain: "tron",
    rpc: "https://nile.trongrid.io",
    chainId: "3448148188",
    deployment: "",
    token: "",
    domain: "",
  },
};
const orderTuple =
  "(bytes32 id,address merchant,address token,uint256 amount,uint256 executorFee)";
const signedAbi = PORTABLE_COLLECTION_FACTORY_ABI;
const tokenAbi = [
  "function balanceOf(address) view returns(uint256)",
  "function transfer(address,uint256) returns(bool)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
  "function mint(address,uint256)",
];
const tronTypes = {
  Order: [
    { name: "id", type: "bytes32" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "executorFee", type: "uint256" },
  ],
};
const zeroSol = SystemProgram.programId.toBase58();
type SolWallet = {
  publicKey: PublicKey;
  connect(): Promise<unknown>;
  signMessage(
    m: Uint8Array,
    encoding?: string,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction(t: Transaction): Promise<Transaction>;
  on?(e: string, f: () => void): void;
  off?(e: string, f: () => void): void;
  disconnect?(): Promise<void>;
};
type TronWallet = {
  ready: boolean;
  defaultAddress: { base58: string };
  fullNode: { host: string };
  trx: TronWeb["trx"];
  contract: TronWeb["contract"];
};
function solWallet(): SolWallet {
  return currentSolana();
}
function tronWallet(): TronWallet {
  const w = window as unknown as { tronWeb?: TronWallet };
  if (!w.tronWeb?.ready)
    throw Error("Connect and unlock TronLink on the selected test network.");
  return w.tronWeb;
}
const bn = (n: string) => Buffer.from(n.replace(/^0x/, ""), "hex");
const u64 = (n: string) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const value = (n: string | bigint, d: number) => {
  const v = BigInt(n),
    base = 10n ** BigInt(d),
    tail = (v % base).toString().padStart(d, "0").replace(/0+$/, "");
  return `${v / base}${tail ? "." + tail : ""}`;
};
export const state = (i: Intent) => {
  const balance = BigInt(i.balance),
    total = BigInt(i.received ?? balance + BigInt(i.collected ?? "0"));
  if (total > BigInt(i.terms.amount)) return "overpaid";
  if (total > 0n && total < BigInt(i.terms.amount)) return "partial";
  if (balance > 0n) return "ready";
  return i.settled ? "collected" : "awaiting";
};
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const intentKey = (i: Intent) =>
  [i.network.chain, i.network.chainId, i.network.deployment, i.address].join(
    ":",
  );
const tronTerms = (t: Terms) => [
  t.id,
  t.merchant,
  t.token,
  t.amount,
  t.executorFee,
];
export function configFor(
  i: Intent,
  configured: Record<Chain, Network>,
): Network {
  const c = configured[i.network.chain];
  return {
    ...i.network,
    rpc:
      c.chainId === i.network.chainId ? c.rpc : defaults[i.network.chain].rpc,
    feeToken: c.feeToken || defaults[i.network.chain].feeToken,
    faucet: c.faucet,
  };
}
export function saved(): Intent[] {
  try {
    const rows = JSON.parse(localStorage.getItem("salute.orders") || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => {
      try {
        shape(row);
        return (
          typeof row.balance === "string" &&
          /^\d+$/.test(row.balance) &&
          Array.isArray(row.receipts)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
export function store(i: Intent) {
  try {
    const rows = JSON.parse(localStorage.getItem("salute.orders") || "[]");
    if (!Array.isArray(rows)) return false;
    localStorage.setItem(
      "salute.orders",
      JSON.stringify([
        i,
        ...rows.filter((x) => {
          try {
            return intentKey(x) !== intentKey(i);
          } catch {
            return true;
          }
        }),
      ]),
    );
    return true;
  } catch {
    return false;
  }
}
export async function sha(s: string) {
  return hexlify(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ).slice(2);
}
async function discriminator(s: string) {
  return bn((await sha(`global:${s}`)).slice(0, 16));
}
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
async function solCheck(n: Network, feePayer: string) {
  if (
    n.chainId === "localnet" &&
    !/^http:\/\/(localhost|127\.0\.0\.1):/.test(n.rpc)
  )
    throw Error("Localnet requires a loopback RPC.");
  const c = new Connection(n.rpc, "confirmed");
  const genesis = await c.getGenesisHash();
  if (
    n.chainId !== "localnet" &&
    genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw Error(
      "This portal supports Solana Devnet or explicitly configured localnet only.",
    );
  const domain =
    n.chainId === "localnet" ? "00".repeat(32) : await sha(genesis);
  if (domain !== n.domain)
    throw Error(
      "Solana network domain does not match the RPC. Import the deployment metadata.",
    );
  const account = await c.getAccountInfo(new PublicKey(n.deployment));
  if (!account?.executable)
    throw Error("No executable Salute program at this address.");
  const view = new Transaction().add(
    new TransactionInstruction({
      programId: new PublicKey(n.deployment),
      keys: [],
      data: await discriminator("network_domain"),
    }),
  );
  view.feePayer = new PublicKey(feePayer);
  view.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  const sim = await c.simulateTransaction(view);
  if (
    sim.value.err ||
    !sim.value.returnData ||
    Buffer.from(sim.value.returnData.data[0], "base64").toString("hex") !==
      n.domain
  )
    throw Error(
      "Deployed Solana program has a different signed-intent domain.",
    );
  return c;
}
async function ethRead(n: Network) {
  validateEvmNetwork(n);
  const p = new JsonRpcProvider(n.rpc, undefined, { cacheTimeout: -1 });
  try {
    if (String((await p.getNetwork()).chainId) !== n.chainId)
      throw Error("RPC chain differs from the configured chain.");
    const deployment = await verifyDeployment(p, protocol.factoryArtifact);
    if (!deployment.deployed || getAddress(n.deployment) !== deployment.factory)
      throw Error(
        "Factory differs from the pinned canonical Salute deployment.",
      );
    return p;
  } catch (error) {
    p.destroy();
    throw error;
  }
}
type InjectedProvider = ConstructorParameters<typeof BrowserProvider>[0];
let selectedEvmProvider: InjectedProvider | undefined;
let useWalletConnect = false;
const announcedWallets = new Map<
  string,
  { name: string; rdns: string; provider: InjectedProvider }
>();
export async function wallets() {
  if (typeof window.addEventListener === "function") {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.info?.uuid && detail?.provider?.request)
        announcedWallets.set(detail.info.uuid, {
          name: String(detail.info.name),
          rdns: String(detail.info.rdns || ""),
          provider: detail.provider,
        });
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    window.removeEventListener("eip6963:announceProvider", announce);
  }
  return [...announcedWallets].map(([id, w]) => ({ id, name: w.name }));
}
export function chooseWallet(id: string) {
  selectedEvmProvider = announcedWallets.get(id)?.provider;
  useWalletConnect = id === "walletconnect";
  rememberWalletConnector("evm", useWalletConnect ? "walletconnect" :
    selectedEvmProvider ? announcedWallets.get(id)!.rdns : "injected");
}
// Restore authorization without requesting accounts, signatures or a network switch.
export async function restoreWallet(n: Network): Promise<string> {
  if (n.chain === "solana") {
    setSolanaChain(n.chainId);
    const { selectSolana } = await import("./wallet-connectors");
    const name = walletConnector("solana");
    if (!name) return "";
    selectSolana(name);
    return (await connectSolana(true)).publicKey.toBase58();
  }
  if (n.chain === "tron") {
    const { restoreTron } = await import("./wallet-connectors");
    return restoreTron();
  }
  const connector = walletConnector("evm");
  useWalletConnect = connector === "walletconnect";
  let provider: InjectedProvider | undefined;
  if (useWalletConnect) provider = await walletConnectProvider(n, false);
  else if (connector === "injected")
    provider = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  else {
    await wallets();
    provider = [...announcedWallets.values()].find((w) => w.rdns === connector)?.provider;
  }
  if (!provider) return "";
  selectedEvmProvider = useWalletConnect ? undefined : provider;
  const accounts = await provider.request({ method: "eth_accounts", params: [] });
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? getAddress(accounts[0]) : "";
}
export function watchEvmWallet(f: (account: string) => void) {
  const provider = ((useWalletConnect
    ? activeWalletConnectProvider()
    : selectedEvmProvider) ||
    (window as unknown as { ethereum?: InjectedProvider }).ethereum) as
    | (InjectedProvider & {
        on?: (e: string, f: (accounts: string[]) => void) => void;
        removeListener?: (e: string, f: (accounts: string[]) => void) => void;
      })
    | undefined;
  const changed = (accounts: string[]) => f(accounts[0] || "");
  provider?.on?.("accountsChanged", changed);
  return () => {
    provider?.removeListener?.("accountsChanged", changed);
  };
}
export function validateEvmNetwork(n: Network) {
  if (!isEvm(n.chain)) throw Error("Expected an EVM network.");
  const local = ["31337", "1337"].includes(n.chainId);
  if (local && !/^http:\/\/(localhost|127\.0\.0\.1):/.test(n.rpc))
    throw Error("Local EVM requires a loopback RPC.");
  if (!local && n.chainId !== evmNetworks[n.chain].chainId)
    throw Error("Select the supported testnet for this chain.");
}
async function ethWallet(n: Network) {
  validateEvmNetwork(n);
  const injected =
    (useWalletConnect ? await walletConnectProvider(n) : selectedEvmProvider) ||
    (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  if (!injected)
    throw Error("Install MetaMask, Rabby or a compatible EVM wallet.");
  const chainId = "0x" + BigInt(n.chainId).toString(16);
  await injected.request({ method: "eth_requestAccounts", params: [] });
  if (
    BigInt((await injected.request({ method: "eth_chainId" })) as string) !==
    BigInt(n.chainId)
  ) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (e) {
      const error = e as {
        code?: number;
        data?: { originalError?: { code?: number } };
      };
      if (error.code !== 4902 && error.data?.originalError?.code !== 4902)
        throw e;
      const config = evmNetworks[n.chain as EvmChain];
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: ["31337", "1337"].includes(n.chainId)
              ? `${n.chain} Local ${n.chainId}`
              : config.name,
            rpcUrls: [n.rpc],
            nativeCurrency: {
              name: config.gas,
              symbol: config.gas,
              decimals: 18,
            },
            ...(["31337", "1337"].includes(n.chainId) || !config.explorer
              ? {}
              : { blockExplorerUrls: [config.explorer] }),
          },
        ],
      });
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    }
  }
  if (
    BigInt((await injected.request({ method: "eth_chainId" })) as string) !==
    BigInt(n.chainId)
  )
    throw Error("Wallet is on the wrong network.");
  return new BrowserProvider(injected, "any", { cacheTimeout: -1 });
}
export const tempoFeeManager = "0xfeec000000000000000000000000000000000000";
const feeAbi = [
  "function userTokens(address) view returns(address)",
  "function setUserToken(address)",
];
export async function prepareTempoGas(
  n: Network,
  onReceipt?: (r: Receipt) => void,
): Promise<Receipt> {
  if (n.chain !== "tempo" || !n.feeToken)
    throw Error("Configure the Tempo fee token first.");
  const p = await ethWallet(n),
    signer = await p.getSigner();
  const tx = await new Contract(tempoFeeManager, feeAbi, signer).setUserToken(
    n.feeToken,
  );
  onReceipt?.({
    kind: "gas token",
    hash: tx.hash,
    status: "pending",
    at: new Date().toISOString(),
  });
  let receipt;
  try {
    receipt =
      n.chain === "tempo"
        ? await waitTempoReceipt(p, tx.hash, 90000)
        : await tx.wait(1, 90000);
  } catch (e) {
    if ((e as { code?: string }).code === "TIMEOUT")
      throw Error(
        "Confirmation timeout. Gas-token transaction remains pending; check its receipt before retrying.",
      );
    throw e;
  }
  if (!receipt || receipt.status !== 1)
    throw Error("Gas-token selection failed.");
  return {
    kind: "gas token",
    hash: tx.hash,
    status: "confirmed",
    at: new Date().toISOString(),
  };
}
async function checkTempoGas(n: Network, signer: string, p: BrowserProvider) {
  const feeToken = await new Contract(tempoFeeManager, feeAbi, p).userTokens(
    signer,
  );
  if (!n.feeToken || getAddress(feeToken) !== getAddress(n.feeToken))
    throw Error(
      "Prepare Tempo gas first: select the configured faucet stablecoin in your wallet.",
    );
  if ((await new Contract(feeToken, tokenAbi, p).balanceOf(signer)) === 0n)
    throw Error(
      "Your Tempo gas stablecoin balance is empty. Fund this wallet from the testnet faucet.",
    );
}
async function tronRead(n: Network) {
  if (
    n.chainId === "local" &&
    !/^http:\/\/(localhost|127\.0\.0\.1):/.test(n.rpc)
  )
    throw Error("Local TRE requires a loopback RPC.");
  if (!["3448148188", "2494104990", "local"].includes(n.chainId))
    throw Error("Use TRON Nile, Shasta or a local TRE.");
  const w = new TronWeb({ fullHost: n.rpc });
  w.setAddress(n.deployment);
  const block = await w.trx.getBlock(0);
  const chain = String(BigInt("0x" + block.blockID.slice(-8)));
  if (n.chainId !== "local" && chain !== n.chainId)
    throw Error("TRON RPC is on the wrong chain.");
  return w;
}
async function checkTronWallet(n: Network) {
  const wallet = tronWallet();
  const check = new TronWeb({ fullHost: wallet.fullNode.host });
  const b = await check.trx.getBlock(0);
  const expected = await (await tronRead(n)).trx.getBlock(0);
  if (b.blockID !== expected.blockID)
    throw Error("Switch TronLink to the selected test network.");
  return wallet;
}
export async function connect(n: Network): Promise<string> {
  if (n.chain === "solana") {
    setSolanaChain(n.chainId);
    const w = await connectSolana();
    await w.connect();
    return w.publicKey.toBase58();
  }
  if (isEvm(n.chain))
    return (await (await ethWallet(n)).getSigner()).getAddress();
  await connectTron(n.chainId);
  return (await checkTronWallet(n)).defaultAddress.base58;
}
export async function create(
  n: Network,
  reference: string,
  input: string,
  reward: string,
  native: boolean,
): Promise<Intent> {
  if (n.chain === "tempo" && native)
    throw Error(
      "Tempo supports TIP-20 payments only; there is no native asset.",
    );
  const merchant = await connect(n);
  const token = native
    ? n.chain === "solana"
      ? zeroSol
      : n.chain === "tron"
        ? TronWeb.address.fromHex("410000000000000000000000000000000000000000")
        : ZeroAddress
    : n.token;
  if (!token) throw Error("Configure the dummy token address first.");
  let decimals = native
      ? n.chain === "solana"
        ? 9
        : n.chain === "tron"
          ? 6
          : 18
      : 6,
    asset = native
      ? n.chain === "solana"
        ? "SOL"
        : n.chain === "tron"
          ? "TRX"
          : gasAsset(n.chain)
      : "sUSD";
  if (n.chain === "solana") {
    const c = await solCheck(n, merchant);
    if (!native) decimals = (await getMint(c, new PublicKey(token))).decimals;
  } else if (isEvm(n.chain)) {
    const p = await ethRead(n);
    try {
      if (!native) {
        const c = new Contract(token, tokenAbi, p);
        decimals = Number(await c.decimals());
        asset = String(await c.symbol());
      }
    } finally {
      p.destroy();
    }
  } else {
    const w = await tronRead(n);
    if (!native) {
      const t = await w.contract().at(token);
      decimals = Number(await t.decimals().call());
      asset = String(await t.symbol().call());
    }
  }
  if (decimals > 18) throw Error("Unsupported token precision.");
  const amount = parseUnits(input, decimals),
    fee = parseUnits(reward, decimals);
  if (amount <= 0n || fee < 0n || fee >= amount)
    throw Error("Amount must be positive and reward must be below the total.");
  if (n.chain === "solana" && amount > 18446744073709551615n)
    throw Error("Amount exceeds the Solana u64 limit.");
  const terms: Terms = {
    id: hexlify(randomBytes(32)),
    merchant,
    token,
    amount: String(amount),
    executorFee: String(fee),
  };
  if (isEvm(n.chain)) terms.originChainId = n.chainId;
  let signature = "",
    address = "";
  if (n.chain === "solana") {
    const signed = await solWallet().signMessage(solMessage(n, terms), "utf8");
    signature = hexlify("signature" in signed ? signed.signature : signed);
    const a = solAddresses(n, terms);
    address = (native ? a.vault : a.ata).toBase58();
  } else if (isEvm(n.chain)) {
    const w = await ethWallet(n);
    signature = await (
      await w.getSigner()
    ).signTypedData(
      {
        name: "Salute",
        version: "4",
        chainId: n.chainId,
        verifyingContract: n.deployment,
      },
      portableTypes,
      terms,
    );
    address = await new Contract(n.deployment, signedAbi, w).predictAddress(
      terms,
    );
  } else {
    const w = await checkTronWallet(n);
    const block = await (await tronRead(n)).trx.getBlock(0);
    const domain = {
      name: "Salute",
      version: "4",
      chainId:
        n.chainId === "local"
          ? String(BigInt("0x" + block.blockID.slice(-8)))
          : n.chainId,
      verifyingContract: n.deployment,
    };
    const sign = w.trx.signTypedData || w.trx._signTypedData;
    if (!sign) throw Error("Update TronLink: TIP-712 signing is required.");
    signature = await sign.call(w.trx, domain, tronTypes, terms);
    const c = await (
      await tronRead(n)
    ).contract(protocol.tronFactoryAbi as never, n.deployment);
    address = TronWeb.address.fromHex(
      await c.predictAddress(tronTerms(terms)).call(),
    );
  }
  const { rpc, ...network } = n;
  void rpc;
  const i: Intent = {
    version: 4,
    network,
    terms,
    address,
    signature,
    reference: reference.trim().slice(0, 80) || "Payment",
    asset,
    decimals,
    createdAt: new Date().toISOString(),
    balance: "0",
    settled: false,
    receipts: [],
  };
  await verify(n, i);
  i.verifiedAt = new Date().toISOString();
  store(i);
  return i;
}
function shape(i: Intent) {
  if (
    !i ||
    i.version !== 4 ||
    !chains.includes(i.network?.chain) ||
    typeof i.network?.chainId !== "string" ||
    typeof i.network?.deployment !== "string" ||
    typeof i.address !== "string" ||
    typeof i.reference !== "string" ||
    i.reference.length > 80 ||
    !Array.isArray(i.receipts) ||
    !/^0x[\da-f]{64}$/i.test(i.terms?.id) ||
    !/^\d+$/.test(i.terms?.amount) ||
    !/^\d+$/.test(i.terms?.executorFee) ||
    BigInt(i.terms.amount) <= 0n ||
    BigInt(i.terms.executorFee) >= BigInt(i.terms.amount) ||
    typeof i.signature !== "string" ||
    i.signature.length > 8192 ||
    !/^0x[\da-f]+$/i.test(i.signature)
  )
    throw Error("Invalid signed payment terms.");
  if (isEvm(i.network.chain) && i.terms.originChainId !== i.network.chainId)
    throw Error("Origin chain differs from signed order.");
}
export async function verify(n: Network, i: Intent) {
  shape(i);
  if (n.chain === "tempo" && i.terms.token === ZeroAddress)
    throw Error("Native payments are unsupported on Tempo.");
  if (
    n.chain !== i.network.chain ||
    n.chainId !== i.network.chainId ||
    n.deployment !== i.network.deployment
  )
    throw Error("Payment belongs to another network or deployment.");
  if (n.chain === "solana") {
    await solCheck(n, i.terms.merchant);
    const a = solAddresses(n, i.terms);
    if (
      (i.terms.token === zeroSol ? a.vault : a.ata).toBase58() !== i.address ||
      !nacl.sign.detached.verify(
        solMessage(n, i.terms),
        bn(i.signature),
        a.merchant.toBytes(),
      )
    )
      throw Error("Invalid Solana merchant signature or deposit address.");
  } else if (isEvm(n.chain)) {
    const p = await ethRead(n);
    try {
      const c = new Contract(n.deployment, signedAbi, p);
      if (
        !(await c.verifyOrder(i.terms, i.signature)) ||
        getAddress(await c.predictAddress(i.terms)) !== getAddress(i.address)
      )
        throw Error("Invalid EIP-712 signature or deposit address.");
    } finally {
      p.destroy();
    }
  } else {
    const w = await tronRead(n),
      c = await w.contract(protocol.tronFactoryAbi as never, n.deployment);
    if (
      !(await c.verifyOrder(tronTerms(i.terms), i.signature).call()) ||
      TronWeb.address.fromHex(
        await c.predictAddress(tronTerms(i.terms)).call(),
      ) !== i.address
    )
      throw Error("Invalid TIP-712 signature or deposit address.");
  }
  if (n.chain === "solana") {
    if (i.terms.token === zeroSol) {
      i.decimals = 9;
      i.asset = "SOL";
    } else {
      i.decimals = (
        await getMint(
          new Connection(n.rpc, "confirmed"),
          new PublicKey(i.terms.token),
        )
      ).decimals;
      i.asset =
        i.terms.token === deploymentRegistry.networks.solana.token ||
        (n.chainId === "localnet" && i.terms.token === n.token)
          ? "sUSD"
          : "SPL token";
    }
  } else if (isEvm(n.chain)) {
    if (i.terms.token === ZeroAddress) {
      i.decimals = 18;
      i.asset = gasAsset(n.chain);
    } else {
      const p = await ethRead(n);
      try {
        const t = new Contract(i.terms.token, tokenAbi, p);
        i.decimals = Number(await t.decimals());
        i.asset = String(await t.symbol()).slice(0, 16);
      } finally {
        p.destroy();
      }
    }
  } else {
    if (
      i.terms.token ===
      TronWeb.address.fromHex("410000000000000000000000000000000000000000")
    ) {
      i.decimals = 6;
      i.asset = "TRX";
    } else {
      const t = await (await tronRead(n)).contract().at(i.terms.token);
      i.decimals = Number(await t.decimals().call());
      i.asset = String(await t.symbol().call()).slice(0, 16);
    }
  }
  if (!Number.isInteger(i.decimals) || i.decimals < 0 || i.decimals > 18)
    throw Error("Unsupported token precision.");
}
export async function refresh(n: Network, i: Intent, persist = true): Promise<Intent> {
  await verify(n, i);
  let balance = 0n;
  if (n.chain === "solana") {
    const c = new Connection(n.rpc, "confirmed"),
      a = solAddresses(n, i.terms),
      info = await c.getAccountInfo(a.order);
    if (info) {
      if (!info.owner.equals(a.program) || info.data.length < 130)
        throw Error("Invalid Solana order account.");
    }
    if (i.terms.token === zeroSol) {
      const b = BigInt(await c.getBalance(a.vault)),
        reserve = info ? info.data.readBigUInt64LE(120) : 0n;
      balance = b > reserve ? b - reserve : 0n;
    } else {
      try {
        balance = BigInt((await c.getTokenAccountBalance(a.ata)).value.amount);
      } catch {
        if (await c.getAccountInfo(a.ata))
          throw Error("Unable to read vault token balance.");
      }
    }
  } else if (isEvm(n.chain)) {
    const p = await ethRead(n);
    try {
      balance =
        i.terms.token === ZeroAddress
          ? await p.getBalance(i.address)
          : BigInt(
              await new Contract(i.terms.token, tokenAbi, p).balanceOf(
                i.address,
              ),
            );
    } finally {
      p.destroy();
    }
  } else {
    const w = await tronRead(n);
    if (
      i.terms.token ===
      TronWeb.address.fromHex("410000000000000000000000000000000000000000")
    )
      balance = BigInt(await w.trx.getBalance(i.address));
    else
      balance = BigInt(
        await (
          await w.contract().at(i.terms.token)
        )
          .balanceOf(i.address)
          .call(),
      );
  }
  const receipts = await Promise.all(
    i.receipts.map(async (r) => {
      if (r.status !== "pending" || (r.chain && r.chain !== n.chain)) return r;
      let status: Receipt["status"] = "pending";
      if (isEvm(n.chain)) {
        const p = await ethRead(n);
        try {
          const receipt = await p.getTransactionReceipt(r.hash);
          if (receipt) status = receipt.status === 1 ? "confirmed" : "failed";
        } finally {
          p.destroy();
        }
      } else if (n.chain === "solana") {
        const result = (
          await new Connection(n.rpc, "confirmed").getSignatureStatuses(
            [r.hash],
            { searchTransactionHistory: true },
          )
        ).value[0];
        if (result?.err) status = "failed";
        else if (
          result?.confirmationStatus === "confirmed" ||
          result?.confirmationStatus === "finalized"
        )
          status = "confirmed";
      } else {
        const receipt = await (
          await tronRead(n)
        ).trx.getTransactionInfo(r.hash);
        if (receipt.id)
          status =
            receipt.result === "FAILED" ||
            (receipt.receipt?.result && receipt.receipt.result !== "SUCCESS")
              ? "failed"
              : "confirmed";
      }
      return { ...r, status };
    }),
  );
  const next = {
    ...i,
    receipts,
    balance: String(balance),
    settled:
      i.settled ||
      receipts.some((r) => r.kind === "settle" && r.status === "confirmed"),
    verifiedAt: new Date().toISOString(),
  };
  if (persist) store(next);
  return next;
}
export function paymentLink(i: Intent) {
  if (i.slug) return `${location.origin}/pay/${i.slug}`;
  const payload = {
    ...i,
    balance: "0",
    settled: false,
    received: undefined,
    collected: undefined,
    verifiedAt: undefined,
    receipts: [],
  };
  return `${location.origin}/pay/offline#pay=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))))}`;
}
export function parseLink(s: string): Intent {
  const encoded = s.includes("#pay=") ? s.split("#pay=")[1] : null;
  const x = JSON.parse(
    encoded ? decodeURIComponent(escape(atob(decodeURIComponent(encoded)))) : s,
  );
  shape(x);
  return {
    ...x,
    balance: "0",
    settled: false,
    received: undefined,
    collected: undefined,
    verifiedAt: undefined,
    receipts: [],
  };
}
export function explorer(n: Network, hash: string) {
  if (n.chain === "solana" && n.chainId === "devnet")
    return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
  if (
    isEvm(n.chain) &&
    evmNetworks[n.chain].explorer &&
    n.chainId === evmNetworks[n.chain].chainId
  )
    return `${evmNetworks[n.chain].explorer}/tx/${hash}`;
  if (n.chain === "tron" && n.chainId === "3448148188")
    return `https://nile.tronscan.org/#/transaction/${hash}`;
  if (n.chain === "tron" && n.chainId === "2494104990")
    return `https://shasta.tronscan.org/#/transaction/${hash}`;
  return "";
}
export async function act(
  n: Network,
  i: Intent,
  kind: "deposit" | "settle" | "mint",
  input: string,
  onReceipt: (r: Receipt) => void,
  expectedAccount?: string,
  waiveReward = false,
) {
  await verify(n, i);
  const account = await connect(n);
  if (
    expectedAccount &&
    (isEvm(n.chain)
      ? account.toLowerCase() !== expectedAccount.toLowerCase()
      : account !== expectedAccount)
  )
    throw Error(
      "Wallet account changed. Review the executor address before sending.",
    );
  let hash = "";
  const record = (status: Receipt["status"]) => {
    const r = {
      kind,
      hash,
      status,
      chain: n.chain,
      at: new Date().toISOString(),
    };
    onReceipt(r);
    const current = saved().find((x) => intentKey(x) === intentKey(i)) || i;
    store({
      ...current,
      receipts: [...current.receipts.filter((x) => x.hash !== hash), r],
    });
  };
  try {
    if (isEvm(n.chain)) {
      const p = await ethWallet(n),
        s = await p.getSigner();
      if (n.chain === "tempo") await checkTempoGas(n, account, p);
      let tx;
      if (kind === "deposit") {
        const amount = parseUnits(input, i.decimals);
        if (amount <= 0n) throw Error("Deposit must be positive.");
        tx =
          i.terms.token === ZeroAddress
            ? await s.sendTransaction({ to: i.address, value: amount })
            : await new Contract(i.terms.token, tokenAbi, s).transfer(
                i.address,
                amount,
              );
      } else if (kind === "mint") {
        if (
          i.asset !== "sUSD" ||
          getAddress(i.terms.token) !== getAddress(n.token)
        )
          throw Error("Only the dummy test token can be minted.");
        tx = await new Contract(i.terms.token, tokenAbi, s).mint(
          account,
          parseUnits("1000", i.decimals),
        );
      } else {
        const f = new Contract(n.deployment, signedAbi, s);
        await f.collect.staticCall(
          i.terms,
          i.signature,
          i.terms.token,
          waiveReward,
        );
        tx = await f.collect(i.terms, i.signature, i.terms.token, waiveReward);
      }
      hash = tx.hash;
      record("pending");
      let receipt;
      try {
        receipt =
          n.chain === "tempo"
            ? await waitTempoReceipt(p, tx.hash, 90000)
            : await tx.wait(1, 90000);
      } catch (e) {
        const replacement = e as {
          code?: string;
          cancelled?: boolean;
          receipt?: { status: number; hash: string };
          replacement?: { hash: string };
        };
        if (replacement.code === "TIMEOUT")
          throw Error(
            "Confirmation timeout. Transaction remains pending; check its receipt before retrying.",
          );
        if (
          replacement.code !== "TRANSACTION_REPLACED" ||
          replacement.cancelled ||
          replacement.receipt?.status !== 1
        )
          throw e;
        // A wallet speed-up keeps the same call. Track the mined replacement.
        record("replaced");
        receipt = replacement.receipt;
        hash = replacement.replacement?.hash || receipt.hash;
        record("pending");
      }
      if (!receipt || receipt.status !== 1)
        throw Error("Transaction reverted.");
    } else if (n.chain === "solana") {
      if (kind === "mint")
        throw Error(
          "Transfer dummy tokens from the merchant wallet to the payer, or use the deployment mint command.",
        );
      const c = await solCheck(n, account),
        w = solWallet(),
        a = solAddresses(n, i.terms),
        payer = new PublicKey(account),
        tx = new Transaction(),
        native = i.terms.token === zeroSol;
      const info = await c.getAccountInfo(a.order);
      if (kind === "deposit") {
        const amount = parseUnits(input, i.decimals);
        if (amount <= 0n || amount > 18446744073709551615n)
          throw Error("Invalid deposit amount.");
        if (native) {
          if (
            !(await c.getAccountInfo(a.vault)) &&
            amount < BigInt(await c.getMinimumBalanceForRentExemption(0))
          )
            throw Error(
              "This new SOL address requires a rent-exempt first balance. Ask the merchant to prepare it before sending a tiny payment.",
            );
          tx.add(
            SystemProgram.transfer({
              fromPubkey: payer,
              toPubkey: a.vault,
              lamports: amount,
            }),
          );
        } else {
          if (!(await c.getAccountInfo(a.ata)))
            throw Error(
              "Merchant must prepare this SPL payment address before funding.",
            );
          tx.add(
            createTransferCheckedInstruction(
              getAssociatedTokenAddressSync(a.mint, payer),
              a.mint,
              a.ata,
              payer,
              amount,
              i.decimals,
            ),
          );
        }
      } else {
        if (!info) {
          tx.add(
            Ed25519Program.createInstructionWithPublicKey({
              publicKey: a.merchant.toBytes(),
              message: solMessage(n, i.terms),
              signature: bn(i.signature),
            }),
          );
          const keys = [
            meta(payer, true, true),
            meta(a.merchant),
            meta(SYSVAR_INSTRUCTIONS_PUBKEY),
            meta(a.order, true),
            meta(a.vault, true),
          ];
          if (!native)
            keys.push(
              meta(a.mint),
              meta(a.ata, true),
              meta(TOKEN_PROGRAM_ID),
              meta(ASSOCIATED_TOKEN_PROGRAM_ID),
            );
          keys.push(meta(SystemProgram.programId));
          tx.add(
            new TransactionInstruction({
              programId: a.program,
              keys,
              data: Buffer.concat([
                await discriminator(native ? "register_sol" : "register_token"),
                bn(i.terms.id),
                u64(i.terms.amount),
                u64(i.terms.executorFee),
              ]),
            }),
          );
        }
        let keys;
        if (native)
          keys = [
            meta(a.order, true),
            meta(a.vault, true),
            meta(a.merchant, true),
            meta(payer, true, true),
            meta(SystemProgram.programId),
          ];
        else {
          const merchantAta = getAssociatedTokenAddressSync(
              a.mint,
              a.merchant,
              true,
            ),
            executorAta = getAssociatedTokenAddressSync(a.mint, payer);
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(
              payer,
              merchantAta,
              a.merchant,
              a.mint,
            ),
          );
          if (
            BigInt(i.terms.executorFee) > 0n &&
            !waiveReward &&
            account !== i.terms.merchant
          )
            tx.add(
              createAssociatedTokenAccountIdempotentInstruction(
                payer,
                executorAta,
                payer,
                a.mint,
              ),
            );
          keys = [
            meta(a.order, true),
            meta(a.vault),
            meta(a.mint),
            meta(a.ata, true),
            meta(a.merchant),
            meta(merchantAta, true),
            meta(payer, false, true),
            meta(executorAta, true),
            meta(TOKEN_PROGRAM_ID),
          ];
        }
        tx.add(
          new TransactionInstruction({
            programId: a.program,
            keys,
            data: Buffer.concat([
              await discriminator(native ? "collect_sol" : "collect_token"),
              Buffer.from([waiveReward ? 1 : 0]),
            ]),
          }),
        );
      }
      const block = await c.getLatestBlockhash();
      tx.feePayer = payer;
      tx.recentBlockhash = block.blockhash;
      const signed = await w.signTransaction(tx);
      hash = await c.sendRawTransaction(signed.serialize());
      record("pending");
      const result = await waitSolanaReceipt(c, hash, block);
      if (result.value.err)
        throw Error(
          "Solana transaction failed: " + JSON.stringify(result.value.err),
        );
    } else {
      const w = await checkTronWallet(n);
      if (kind === "deposit") {
        const amount = parseUnits(input, i.decimals);
        if (amount <= 0n) throw Error("Deposit must be positive.");
        if (i.asset === "TRX") {
          if (amount > BigInt(Number.MAX_SAFE_INTEGER))
            throw Error(
              "TRX deposit exceeds the wallet's exact numeric limit.",
            );
          const result = await w.trx.sendTransaction(i.address, Number(amount));
          if (!result.result) throw Error("TRON broadcast rejected.");
          hash = result.txid;
        } else
          hash = await (
            await w.contract().at(i.terms.token)
          )
            .transfer(i.address, String(amount))
            .send({ feeLimit: 100_000_000 });
      } else if (kind === "mint") {
        if (i.asset !== "sUSD")
          throw Error("Only the dummy token can be minted.");
        hash = await (
          await w.contract().at(i.terms.token)
        )
          .mint(account, String(parseUnits("1000", i.decimals)))
          .send({ feeLimit: 100_000_000 });
      } else
        hash = await (
          await w.contract(protocol.tronFactoryAbi as never, n.deployment)
        )
          .collect(tronTerms(i.terms), i.signature, i.terms.token, waiveReward)
          .send({ feeLimit: 500_000_000 });
      record("pending");
      const deadline = Date.now() + 90000;
      let ok = false;
      while (Date.now() < deadline) {
        const receipt = await w.trx.getTransactionInfo(hash);
        if (receipt?.id) {
          if (
            (receipt.receipt?.result && receipt.receipt.result !== "SUCCESS") ||
            receipt.result === "FAILED"
          )
            throw Error("TRON transaction reverted.");
          ok = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!ok)
        throw Error(
          "Confirmation timeout. Transaction remains pending; check its explorer before retrying.",
        );
    }
    record("confirmed");
    return hash;
  } catch (e) {
    if (hash) {
      const text = e instanceof Error ? e.message : "";
      // A lost RPC response is not proof of failure. Only known reverts/cancels
      // release the pending guard; retain uncertain broadcasts for reconciliation.
      const code = (e as { code?: string }).code;
      record(
        /reverted|transaction failed|broadcast rejected/i.test(text) ||
          code === "CALL_EXCEPTION" ||
          code === "TRANSACTION_REPLACED"
          ? "failed"
          : "pending",
      );
    }
    throw e;
  }
}

export const portableTypes = {
  PortableOrder: [
    { name: "id", type: "bytes32" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "executorFee", type: "uint256" },
    { name: "originChainId", type: "uint256" },
  ],
};
export async function signLogin(n: Network, message: string) {
  await connect(n);
  if (isEvm(n.chain))
    return (await (await ethWallet(n)).getSigner()).signMessage(message);
  if (n.chain === "solana") {
    const signed = await solWallet().signMessage(
      new TextEncoder().encode(message),
    );
    return hexlify("signature" in signed ? signed.signature : signed);
  }
  return (await checkTronWallet(n)).trx.signMessageV2(message);
}
export async function prepareSolanaPayment(n: Network, i: Intent) {
  if (n.chain !== "solana") return;
  await verify(n, i);
  const account = await connect(n);
  if (account !== i.terms.merchant)
    throw Error(
      "Only the connected merchant can sponsor payment-address setup.",
    );
  const c = await solCheck(n, account),
    a = solAddresses(n, i.terms),
    native = i.terms.token === zeroSol;
  if (await c.getAccountInfo(a.order)) return;
  const payer = new PublicKey(account),
    keys = [
      meta(payer, true, true),
      meta(a.merchant),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY),
      meta(a.order, true),
      meta(a.vault, true),
    ];
  if (!native)
    keys.push(
      meta(a.mint),
      meta(a.ata, true),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
    );
  keys.push(meta(SystemProgram.programId));
  const tx = new Transaction().add(
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: a.merchant.toBytes(),
      message: solMessage(n, i.terms),
      signature: bn(i.signature),
    }),
    new TransactionInstruction({
      programId: a.program,
      keys,
      data: Buffer.concat([
        await discriminator(native ? "register_sol" : "register_token"),
        bn(i.terms.id),
        u64(i.terms.amount),
        u64(i.terms.executorFee),
      ]),
    }),
  );
  const block = await c.getLatestBlockhash();
  tx.feePayer = payer;
  tx.recentBlockhash = block.blockhash;
  const signed = await solWallet().signTransaction(tx),
    hash = await c.sendRawTransaction(signed.serialize());
  const receipt = await waitSolanaReceipt(c, hash, block);
  if (receipt.value.err) throw Error("Payment-address setup failed.");
  return hash;
}
export async function recoverEvm(
  n: Network,
  i: Intent,
  asset: string,
  waive = true,
  onReceipt: (r: Receipt) => void = () => {},
  quote?: { authorization: unknown; signature: string },
) {
  if (!isEvm(n.chain) || !isEvm(i.network.chain))
    throw Error("Cross-chain recovery is EVM-only.");
  const p = await ethRead(n),
    f = new Contract(n.deployment, signedAbi, p);
  try {
    if (
      quote &&
      getAddress((quote.authorization as { asset: string }).asset) !==
        getAddress(asset)
    )
      throw Error(
        "The reward quote asset differs from the selected recovery asset.",
      );
    if (
      getAddress(n.deployment) !== getAddress(i.network.deployment) ||
      getAddress(await f.predictAddress(i.terms)) !== getAddress(i.address) ||
      !(await f.verifyOrder(i.terms, i.signature))
    )
      throw Error(
        "Recovery requires matching canonical deployment and portable merchant authorization.",
      );
  } finally {
    p.destroy();
  }
  const w = await ethWallet(n),
    signer = await w.getSigner();
  if (n.chain === "tempo") await checkTempoGas(n, await signer.getAddress(), w);
  const factory = new Contract(n.deployment, signedAbi, signer),
    method = quote ? factory.collectWithReward : factory.collect;
  const args = quote
    ? [i.terms, i.signature, quote.authorization, quote.signature]
    : [i.terms, i.signature, asset, waive];
  await method.staticCall(...args);
  const tx = await method(...args);
  let recoveryHash = tx.hash;
  onReceipt({
    kind: "recovery",
    hash: tx.hash,
    status: "pending",
    at: new Date().toISOString(),
  });
  try {
    const receipt =
      n.chain === "tempo"
        ? await waitTempoReceipt(w, tx.hash, 90000)
        : await tx.wait(1, 90000);
    if (!receipt || receipt.status !== 1) throw Error("Recovery reverted.");
  } catch (error) {
    const replacement = error as {
      code?: string;
      cancelled?: boolean;
      receipt?: { status: number; hash: string };
      replacement?: { hash: string };
    };
    const code = replacement.code;
    if (
      code === "TRANSACTION_REPLACED" &&
      !replacement.cancelled &&
      replacement.receipt?.status === 1
    ) {
      onReceipt({
        kind: "recovery",
        hash: tx.hash,
        status: "replaced",
        at: new Date().toISOString(),
        chain: n.chain,
      });
      recoveryHash = replacement.replacement?.hash || replacement.receipt.hash;
    } else {
      onReceipt({
        kind: "recovery",
        hash: tx.hash,
        status:
          code === "CALL_EXCEPTION" ||
          code === "TRANSACTION_REPLACED" ||
          /reverted/i.test(error instanceof Error ? error.message : "")
            ? "failed"
            : "pending",
        at: new Date().toISOString(),
        chain: n.chain,
      });
      throw error;
    }
  }
  onReceipt({
    kind: "recovery",
    hash: recoveryHash,
    status: "confirmed",
    at: new Date().toISOString(),
  });
  return recoveryHash;
}

/** Public test-token faucet; never mints native gas coins or an arbitrary checkout asset. */
export async function mintTestTokens(n: Network): Promise<string> {
  if (!n.token || !n.deployment)
    throw Error("This network's test token is not deployed.");
  const account = await connect(n);
  if (isEvm(n.chain)) {
    const wallet = await ethWallet(n),
      signer = await wallet.getSigner();
    const read = await ethRead(n);
    read.destroy();
    const token = new Contract(n.token, tokenAbi, wallet);
    if (
      (await token.symbol()) !== "sUSD" ||
      Number(await token.decimals()) !== 6
    )
      throw Error("Only configured Salute test tokens can be minted.");
    if (n.chain === "tempo") {
      await checkTempoGas(n, account, wallet);
      if (!n.faucet) throw Error("Tempo test-token faucet is not configured.");
    }
    const faucet = new Contract(
      n.chain === "tempo" ? n.faucet! : n.token,
      ["function mint(address,uint256)"],
      signer,
    );
    const tx = await faucet.mint(account, 1000_000000n);
    const receipt =
      n.chain === "tempo"
        ? await waitTempoReceipt(wallet, tx.hash, 120000)
        : await tx.wait(1, 120000);
    if (!receipt || receipt.status !== 1)
      throw Error("Test token mint failed.");
    return tx.hash;
  }
  if (n.chain === "solana") {
    const c = await solCheck(n, account),
      payer = new PublicKey(account),
      program = new PublicKey(n.deployment),
      mint = new PublicKey(n.token);
    const [authority] = PublicKey.findProgramAddressSync(
        [Buffer.from("test-mint-authority")],
        program,
      ),
      info = await getMint(c, mint);
    if (!info.mintAuthority?.equals(authority) || info.decimals !== 6)
      throw Error(
        "This SPL test mint does not use the public faucet authority.",
      );
    const ata = getAssociatedTokenAddressSync(mint, payer),
      tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          ata,
          payer,
          mint,
        ),
        new TransactionInstruction({
          programId: program,
          keys: [
            meta(authority),
            meta(mint, true),
            meta(ata, true),
            meta(payer, false, true),
            meta(TOKEN_PROGRAM_ID),
          ],
          data: Buffer.concat([
            await discriminator("mint_test_tokens"),
            u64("1000000000"),
          ]),
        }),
      );
    const block = await c.getLatestBlockhash();
    tx.feePayer = payer;
    tx.recentBlockhash = block.blockhash;
    const signed = await solWallet().signTransaction(tx),
      hash = await c.sendRawTransaction(signed.serialize());
    const receipt = await waitSolanaReceipt(c, hash, block);
    if (receipt.value.err) throw Error("SPL faucet mint failed.");
    return hash;
  }
  const w = await checkTronWallet(n),
    token = await w.contract(protocol.tokenAbi as never, n.token);
  if (
    (await token.symbol().call()) !== "sUSD" ||
    Number(await token.decimals().call()) !== 6
  )
    throw Error("Only the configured test token can be minted.");
  const hash = String(
    await token.mint(account, "1000000000").send({ feeLimit: 100000000 }),
  );
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const receipt = await w.trx.getTransactionInfo(hash);
    if (receipt?.id) {
      if (
        receipt.result === "FAILED" ||
        (receipt.receipt?.result && receipt.receipt.result !== "SUCCESS")
      )
        throw Error("TRON faucet mint reverted.");
      return hash;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw Error("Mint confirmation timeout. Check its explorer before retrying.");
}

// Shared public Devnet websocket connections can be throttled independently of HTTP.
// Poll our own signature and preserve pending status instead of resending a payment.
async function waitSolanaReceipt(
  c: Connection,
  signature: string,
  block: { lastValidBlockHeight: number },
) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    // Confirmed signatures can leave a node's recent cache while polling.
    const statuses = await c.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    }),
      status = statuses.value[0];
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return { value: { err: status.err } };
    if (
      !status &&
      (await c.getBlockHeight("confirmed")) > block.lastValidBlockHeight
    )
      throw Error(
        "Transaction block height expired. Check its signature before retrying.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw Error(
    "Confirmation timeout. Transaction remains pending; check its signature before retrying.",
  );
}

// Tempo blocks may contain native 0x76 transactions that ethers cannot parse.
// Confirm our hash from its receipt without fetching unrelated full block transactions.
async function waitTempoReceipt(
  p: BrowserProvider,
  hash: string,
  timeout: number,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const receipt = await p.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error(
    "Confirmation timeout. Transaction remains pending; check its explorer before retrying.",
  );
}
