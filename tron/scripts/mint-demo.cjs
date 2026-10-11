const { TronWeb } = require("tronweb");
async function main() {
  const rpc = process.env.TRON_FULL_NODE_URL || "https://nile.trongrid.io",
    chainId = process.env.TRON_CHAIN_ID || "3448148188";
  if (
    !["3448148188", "2494104990", "local"].includes(chainId) ||
    (chainId === "local" && !/^http:\/\/(localhost|127\.0\.0\.1):/.test(rpc))
  )
    throw Error("Use Nile, Shasta or loopback TRE.");
  if (
    !process.env.TRON_DEPLOYER_PRIVATE_KEY ||
    !TronWeb.isAddress(process.env.DEMO_TOKEN_MINT) ||
    !TronWeb.isAddress(process.env.DEMO_RECIPIENT)
  )
    throw Error(
      "Set TRON_DEPLOYER_PRIVATE_KEY, DEMO_TOKEN_MINT and DEMO_RECIPIENT.",
    );
  const w = new TronWeb({
    fullHost: rpc,
    privateKey: process.env.TRON_DEPLOYER_PRIVATE_KEY,
  });
  const block = await w.trx.getBlock(0);
  if (
    chainId !== "local" &&
    String(BigInt("0x" + block.blockID.slice(-8))) !== chainId
  )
    throw Error("RPC network mismatch.");
  const token = await w.contract().at(process.env.DEMO_TOKEN_MINT);
  if (
    String(await token.symbol().call()) !== "sUSD" ||
    Number(await token.decimals().call()) !== 6
  )
    throw Error("Expected dummy six-decimal sUSD.");
  const input = process.env.DEMO_AMOUNT || "1000";
  if (!/^\d+(\.\d{1,6})?$/.test(input)) throw Error("Invalid decimal amount.");
  const [whole, fraction = ""] = input.split(".");
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (amount === 0n) throw Error("Amount must be positive.");
  console.log(`Mint ${amount} base units to ${process.env.DEMO_RECIPIENT}.`);
  if (!process.argv.includes("--broadcast")) {
    console.log("Dry run; add --broadcast to mint.");
    return;
  }
  const hash = await token
    .mint(process.env.DEMO_RECIPIENT, String(amount))
    .send({
      feeLimit: Number(process.env.TRON_FEE_LIMIT || 1000000000),
      shouldPollResponse: false,
    });
  console.log("Submitted", hash);
  for (let i = 0; i < 40; i++) {
    const receipt = await w.trx.getTransactionInfo(hash);
    if (receipt.id) {
      if (
        receipt.result === "FAILED" ||
        (receipt.receipt?.result && receipt.receipt.result !== "SUCCESS")
      )
        throw Error("Mint reverted.");
      console.log("Mint confirmed.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error("Mint remains pending; check its explorer before retrying.");
}
main().catch((e) => {
  console.error(
    e.code ? `Mint failed (${e.code}); inspect receipt.` : e.message,
  );
  process.exitCode = 1;
});
