const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} = require("node:fs");
const { resolve, dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const { TronWeb } = require("tronweb");
const broadcast = process.argv.includes("--broadcast");
async function main() {
  const rpc = process.env.TRON_FULL_NODE_URL || process.env.TRON_RPC_URL || "https://nile.trongrid.io",
    key = process.env.TRON_DEPLOYER_PRIVATE_KEY,
    chainId = process.env.TRON_CHAIN_ID || "3448148188",
    merchant = process.env.TRON_MERCHANT_ADDRESS || process.env.MERCHANT_ADDRESS;
  if (!key || !TronWeb.isAddress(merchant))
    throw Error("Set TRON_DEPLOYER_PRIVATE_KEY and MERCHANT_ADDRESS.");
  if (!["3448148188", "2494104990", "local"].includes(chainId))
    throw Error("Use Nile, Shasta or local TRE.");
  if (chainId === "local" && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc))
    throw Error("Local TRE deployment requires a loopback RPC.");
  const w = new TronWeb({ fullHost: rpc, privateKey: key }),
    block = await w.trx.getBlock(0);
  if (
    chainId !== "local" &&
    String(BigInt("0x" + block.blockID.slice(-8))) !== chainId
  )
    throw Error("TRON RPC does not match TRON_CHAIN_ID.");
  const output = resolve(
    process.env.DEPLOY_OUTPUT || `../.data/deployments/tron-${chainId}-main.json`,
  );
  if (existsSync(output))
    throw Error(
      "Deployment metadata exists; reuse it or choose another DEPLOY_OUTPUT.",
    );
  if (
    spawnSync("npx", ["tronbox", "compile", "--all"], {
      cwd: resolve(__dirname, ".."),
      stdio: "inherit",
    }).status !== 0
  )
    throw Error("TVM compile failed.");
  const artifact = (n) =>
    JSON.parse(
      readFileSync(resolve(__dirname, `../build/contracts/${n}.json`), "utf8"),
    );
  const f = artifact("SaluteTronFactory"),
    t = artifact("TestUSD"),
    feeLimit = Number(process.env.TRON_FEE_LIMIT || 1000000000);
  if ((await w.trx.getBalance(w.defaultAddress.base58)) <= 0)
    throw Error(
      "Fund and activate the TRON deployer with test TRX before deployment.",
    );
  console.log(
    `TRON ${chainId}; deployer ${w.defaultAddress.base58}; merchant ${merchant}; fee limit per deployment ${feeLimit / 1e6} TRX. Actual cost depends on Energy/Bandwidth.`,
  );
  if (!broadcast) {
    console.log(
      "Compile-only dry run. Add --broadcast to deploy and mint dummy sUSD.",
    );
    return;
  }
  await mkdirSync(dirname(output), { recursive: true });
  const record = {
    chain: "tron",
    rpc,
    chainId,
    deployment: "",
    token: "",
    domain: "",
    merchant,
    createdAt: new Date().toISOString(),
    phase: "factory pending",
  };
  writeFileSync(output, JSON.stringify(record, null, 2), { flag: "wx" });
  const factory = await w.contract().new({
    abi: f.abi,
    bytecode: f.bytecode,
    feeLimit,
    userFeePercentage: 100,
    originEnergyLimit: 1000000,
  });
  record.deployment = factory.address.startsWith("T")
    ? factory.address
    : TronWeb.address.fromHex(factory.address);
  record.phase = "factory confirmed";
  writeFileSync(output, JSON.stringify(record, null, 2));
  const token = await w.contract().new({
    abi: t.abi,
    bytecode: t.bytecode,
    feeLimit,
    userFeePercentage: 100,
    parameters: [merchant],
  });
  record.token = token.address.startsWith("T")
    ? token.address
    : TronWeb.address.fromHex(token.address);
  record.initialSupply = "1000000000000";
  record.phase = "complete";
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  console.log(
    `Import ${output}. 1,000,000 dummy sUSD automatically minted to ${merchant}.`,
  );
}
main().catch((e) => {
  console.error(
    e.code
      ? `TRON deployment failed (${e.code}); inspect its checkpoint.`
      : e.message,
  );
  process.exitCode = 1;
});
