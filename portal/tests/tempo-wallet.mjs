import assert from "node:assert/strict";
import {
  JsonRpcProvider,
  HDNodeWallet,
  NonceManager,
  Contract,
  ContractFactory,
  id,
} from "ethers";
import { readFile } from "node:fs/promises";
import { verifyDeployment } from "../../scripts/collection.mjs";
import {
  create,
  act,
  refresh,
  defaults,
  prepareTempoGas,
} from "../node_modules/.cache/salute-intents.mjs";
const rpc = process.env.TEMPO_LOCAL_RPC || "http://127.0.0.1:18549",
  p = new JsonRpcProvider(rpc, undefined, {
    cacheTimeout: -1,
    pollingInterval: 100,
  }),
  wallets = [3, 4, 5].map((i) =>
    HDNodeWallet.fromPhrase(
      "test test test test test test test test test test test junk",
      undefined,
      `m/44'/60'/0'/0/${i}`,
    ).connect(p),
  );
let active = 1;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc))
  throw Error("Loopback only.");
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
};
globalThis.window = {
  ethereum: {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [wallets[active].address];
      if (method === "eth_chainId") return "0x539";
      if (method === "eth_signTypedData_v4") {
        const d =
          typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        delete d.types.EIP712Domain;
        return wallets[active].signTypedData(d.domain, d.types, d.message);
      }
      if (method === "eth_sendTransaction") {
        const tx = { ...params[0] };
        delete tx.from;
        tx.nonce = await p.getTransactionCount(
          wallets[active].address,
          "pending",
        );
        return (await wallets[active].sendTransaction(tx)).hash;
      }
      return p.send(method, params);
    },
  },
};
try {
  const artifact = JSON.parse(
      await readFile(
        new URL("../../artifacts/PaymentFactory.json", import.meta.url),
      ),
    ),
    plan = await verifyDeployment(p, artifact);
  assert.equal(plan.deployed, true);
  const feeToken = "0x20c0000000000000000000000000000000000001";
  for (const wallet of wallets)
    await (
      await new Contract(
        "0xfeec000000000000000000000000000000000000",
        ["function setUserToken(address)"],
        new NonceManager(wallet),
      ).setUserToken(feeToken)
    ).wait();
  const issuerArtifact = JSON.parse(
      await readFile(
        new URL("../../artifacts/TempoTestUSD.json", import.meta.url),
      ),
    ),
    issuer = await new ContractFactory(
      issuerArtifact.abi,
      issuerArtifact.bytecode,
      new NonceManager(wallets[0]),
    ).deploy(wallets[0].address, feeToken, id(`main-wallet-${Date.now()}`));
  await issuer.waitForDeployment();
  const token = new Contract(
    await issuer.token(),
    [
      "function mint(address,uint256)",
      "function balanceOf(address) view returns(uint256)",
    ],
    new NonceManager(wallets[0]),
  );
  await (await token.mint(wallets[0].address, 600_000_000n)).wait();
  const n = {
    ...defaults.tempo,
    rpc,
    chainId: "1337",
    deployment: plan.factory,
    token: token.target,
    feeToken,
  };
  const i = await create(n, "Tempo wallet flow", "100", "2", false);
  active = 0;
  await act(n, i, "deposit", "10", () => {});
  active = 2;
  await prepareTempoGas(n);
  const before = await token.balanceOf(wallets[1].address);
  await act(n, i, "settle", "", () => {}, wallets[2].address);
  assert.equal(
    (await token.balanceOf(wallets[1].address)) - before,
    8_000_000n,
  );
  active = 0;
  await act(n, i, "deposit", "500", () => {});
  active = 2;
  await act(n, await refresh(n, i), "settle", "", () => {}, wallets[2].address);
  assert.equal(await token.balanceOf(wallets[2].address), 4_000_000n);
  assert.equal(await token.balanceOf(wallets[1].address), 506_000_000n);
  await assert.rejects(
    () => create(n, "No native", "1", "0", true),
    /no native/,
  );
  console.log(
    "PASS actual Tempo wallet client: EIP-712, gas-token preference, TIP-20 deposits, under/overpayment, repeated reward and native rejection",
  );
} finally {
  p.destroy();
}
