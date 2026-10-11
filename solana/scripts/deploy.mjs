import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID, createTransferCheckedInstruction,
} from "@solana/spl-token";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  broadcast = process.argv.includes("--broadcast"),
  resume = process.argv.includes("--resume");
const run = (cmd, args, cwd, env = process.env) => {
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw Error(`${cmd} failed.`);
};
async function main() {
  const merchantAddress = process.env.SOLANA_MERCHANT_ADDRESS || process.env.MERCHANT_ADDRESS;
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    walletPath = process.env.SOLANA_DEPLOYER_KEYPAIR_PATH,
    programPath = process.env.SOLANA_PROGRAM_KEYPAIR_PATH;
  if (!walletPath || !programPath || !merchantAddress)
    throw Error(
      "Set SOLANA_DEPLOYER_KEYPAIR_PATH, SOLANA_PROGRAM_KEYPAIR_PATH and MERCHANT_ADDRESS.",
    );
  const connection = new Connection(rpc, "confirmed"),
    genesis = await connection.getGenesisHash(),
    local = /^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc);
  if (!local && genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw Error("Only Devnet or loopback localnet is supported.");
  const domain = local
      ? "00".repeat(32)
      : createHash("sha256").update(genesis).digest("hex"),
    keypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(resolve(walletPath), "utf8"))),
    ),
    programKey = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(resolve(programPath), "utf8"))),
    ),
    merchant = new PublicKey(merchantAddress),
    id = programKey.publicKey.toBase58(),
    chainId = local ? "localnet" : "devnet",
    output = resolve(
      process.env.DEPLOY_OUTPUT ||
        `${root}/.data/deployments/solana-${chainId}-${id}.json`,
    );
  let checkpoint;
  try { checkpoint = JSON.parse(await readFile(output, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  if (checkpoint && !resume)
    throw Error("Deployment metadata already exists. Inspect it and use --resume; never discard pending state.");
  if (checkpoint && (checkpoint.deployment !== id || checkpoint.domain !== domain || checkpoint.genesis !== genesis || checkpoint.merchant !== merchant.toBase58()))
    throw Error("Checkpoint does not match this program, network or merchant.");
  if (checkpoint?.phase === "complete") {
    console.log("Deployment is complete. Reuse the verified checkpoint; no tokens minted.");
    return;
  }
  if (!checkpoint && await connection.getAccountInfo(programKey.publicKey))
    throw Error(
      "Program address already exists. Reuse its deployment metadata or generate a new program keypair.",
    );
  // Isolated build: keep the development program ID and ledger untouched.
  const build = resolve(root, `.data/solana/build-${id}`),
    src = resolve(build, "programs/salute_pay");
  await mkdir(resolve(src, "src"), { recursive: true });
  for (const name of ["Cargo.toml", "build.rs"])
    await copyFile(
      resolve(root, "solana/programs/salute_pay", name),
      resolve(src, name),
    );
  const rust = await readFile(
    resolve(root, "solana/programs/salute_pay/src/lib.rs"),
    "utf8",
  );
  await writeFile(
    resolve(src, "src/lib.rs"),
    rust.replace(/declare_id!\("[^"]+"\)/, `declare_id!("${id}")`),
  );
  await copyFile(
    resolve(root, "solana/Cargo.toml"),
    resolve(build, "Cargo.toml"),
  );
  await copyFile(
    resolve(root, "solana/Cargo.lock"),
    resolve(build, "Cargo.lock"),
  );
  await writeFile(
    resolve(build, "Anchor.toml"),
    `[toolchain]\nanchor_version = "1.2.0"\n[programs.localnet]\nsalute_pay = "${id}"\n[provider]\ncluster = "${rpc}"\nwallet = "${resolve(walletPath)}"\n`,
  );
  run("anchor", ["build", "--ignore-keys"], build, {
    ...process.env,
    SALUTE_NETWORK_DOMAIN: domain,
  });
  const binary = resolve(build, "target/deploy/salute_pay.so"),
    size = (await readFile(binary)).length;
  const programRent = await connection.getMinimumBalanceForRentExemption(
    size + 45,
  );
  const bufferRent = await connection.getMinimumBalanceForRentExemption(
    size + 37,
  );
  const deployerBalance = await connection.getBalance(keypair.publicKey);
  console.log(
    `Program ${id}; ${size} bytes; network ${chainId}; binary rent minimum ${programRent} lamports; temporary buffer rent ${bufferRent}; deployer balance ${deployerBalance}. Budget both rent amounts plus fees and mint-account rent.`,
  );
  if (deployerBalance < programRent + bufferRent + 50000000)
    throw Error(
      "Fund the Solana deployer for program rent, temporary buffer rent and at least 0.05 SOL for deployment/mint fees and account rent.",
    );
  if (!broadcast) {
    console.log(
      "Build verified. Add --broadcast to deploy and create/mint the dummy SPL token.",
    );
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  const bufferPath = checkpoint?.bufferKeypairPath || resolve(build, "deployment-buffer.json");
  if (!checkpoint) await writeFile(
    bufferPath,
    JSON.stringify(Array.from(Keypair.generate().secretKey)),
    { flag: "wx", mode: 0o600 },
  );
  const record = checkpoint || {
    chain: "solana",
    rpc,
    chainId,
    deployment: id,
    token: "",
    domain,
    merchant: merchant.toBase58(),
    genesis,
    createdAt: new Date().toISOString(),
    upgradeAuthority: keypair.publicKey.toBase58(),
    bufferKeypairPath: bufferPath,
    phase: "program pending",
  };
  if (!checkpoint) await writeFile(output, JSON.stringify(record, null, 2), { flag: "wx" });
  if (!(await connection.getAccountInfo(programKey.publicKey))?.executable) run(
    "solana",
    [
      "program",
      "deploy",
      binary,
      "--max-len",
      String(size),
      "--buffer",
      bufferPath,
      "--use-tpu-client",
      "--max-sign-attempts",
      "8",
      "--with-compute-unit-price",
      "1000",
      "--program-id",
      resolve(programPath),
      "--keypair",
      resolve(walletPath),
      "--url",
      rpc,
    ],
    root,
  );
  // Verify the exact isolated build before irrevocably removing upgrade authority.
  const deployed = await connection.getAccountInfo(programKey.publicKey);
  if (!deployed?.executable) throw Error("Program deployment is still incomplete; preserve checkpoint.");
  const programData = await connection.getAccountInfo(new PublicKey(deployed.data.subarray(4, 36)));
  if (!programData || !programData.data.subarray(45, 45 + size).equals(await readFile(binary)))
    throw Error("Public program bytes do not match the prepared binary; activation refused.");
  if (programData.data[12] !== 0) {
    if (!new PublicKey(programData.data.subarray(13,45)).equals(keypair.publicKey))
      throw Error("Unexpected upgrade authority; checkpoint preserved.");
    run("solana", ["program", "set-upgrade-authority", id, "--final", "--keypair", resolve(walletPath), "--url", rpc], root);
  }
  // The payment program is immutable before token setup or activation.
  record.upgradeAuthority = null;
  record.phase = "program confirmed, immutable";
  await writeFile(output, JSON.stringify(record, null, 2));
  const [faucetAuthority] = PublicKey.findProgramAddressSync([Buffer.from("test-mint-authority")], programKey.publicKey);
  if (!record.token) {
    const mintKey = Keypair.generate();
    record.token = mintKey.publicKey.toBase58();
    record.mintKeypairPath = resolve(build, "test-mint-keypair.json");
    await writeFile(record.mintKeypairPath, JSON.stringify(Array.from(mintKey.secretKey)), { flag: "wx", mode: 0o600 });
    record.phase = "mint prepared";
    await writeFile(output, JSON.stringify(record, null, 2));
  }
  const mint = new PublicKey(record.token);
  if (!await connection.getAccountInfo(mint)) {
    if (!record.mintKeypairPath) throw Error("Missing prepared mint keypair; inspect checkpoint before retrying.");
    const mintKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(record.mintKeypairPath))));
    if (!mintKey.publicKey.equals(mint)) throw Error("Prepared mint keypair mismatch.");
    await createMint(connection, keypair, faucetAuthority, null, 6, mintKey);
  }
  const mintInfo = await getMint(connection, mint);
  if (mintInfo.decimals !== 6 || !mintInfo.mintAuthority?.equals(faucetAuthority)) throw Error("Public test-mint authority mismatch.");
  record.phase = "mint created";
  await writeFile(output, JSON.stringify(record, null, 2));
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    mint,
    merchant,
    true,
  );
  const issuerAta=await getOrCreateAssociatedTokenAccount(connection,keypair,mint,keypair.publicKey);
  const amount=Buffer.alloc(8);amount.writeBigUInt64LE(1000000000000n);
  const mintTransaction=new Transaction().add(new TransactionInstruction({programId:programKey.publicKey,keys:[
    {pubkey:faucetAuthority,isSigner:false,isWritable:false},{pubkey:mint,isSigner:false,isWritable:true},
    {pubkey:issuerAta.address,isSigner:false,isWritable:true},{pubkey:keypair.publicKey,isSigner:true,isWritable:false},
    {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
  ],data:Buffer.concat([createHash("sha256").update("global:mint_test_tokens").digest().subarray(0,8),amount])}));
  if(!issuerAta.address.equals(ata.address))mintTransaction.add(createTransferCheckedInstruction(issuerAta.address,mint,ata.address,keypair.publicKey,1000000000000n,6));
  if (!record.mintTx) {
    const block = await connection.getLatestBlockhash();
    mintTransaction.feePayer = keypair.publicKey;
    mintTransaction.recentBlockhash = block.blockhash;
    mintTransaction.sign(keypair);
    const { createRequire } = await import("node:module");
    const bs58 = createRequire(import.meta.url)("bs58");
    record.mintTx = (bs58.default || bs58).encode(mintTransaction.signature);
    record.mintBlock = block;
    record.phase = "initial mint pending";
    await writeFile(output, JSON.stringify(record, null, 2));
    await connection.sendRawTransaction(mintTransaction.serialize());
  }
  const mintReceipt = await connection.confirmTransaction({ signature: record.mintTx, ...record.mintBlock }, "confirmed");
  if (mintReceipt.value.err) throw Error("Initial mint transaction failed; inspect checkpoint, never remint automatically.");
  record.faucetAuthority=faucetAuthority.toBase58();
  record.merchantTokenAccount = ata.address.toBase58();
  record.initialSupply = "1000000000000";
  record.phase = "complete";
  await writeFile(output, JSON.stringify(record, null, 2) + "\n");
  console.log(
    `Import ${output} in the portal. 1,000,000 dummy sUSD minted to ${merchant}.`,
  );
}
main().catch((e) => {
  console.error(
    e.code
      ? `Solana deployment failed (${e.code}). Check its checkpoint file before retrying.`
      : e.message,
  );
  process.exitCode = 1;
});
