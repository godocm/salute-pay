import { createPrivateKey, sign } from "node:crypto";
import { PublicKey, SystemProgram, Ed25519Program } from "@solana/web3.js";
export function message(program, domain, terms) {
  return Buffer.from(
    `Salute Payment Intent\nNetwork: ${domain}\nProgram: ${program}\nOrder: ${Buffer.from(terms.id).toString("hex")}\nMerchant: ${terms.merchant}\nMint: ${terms.mint}\nAmount: ${terms.amount}\nExecutor reward: ${terms.reward}\n`,
  );
}
export function signature(keypair, data) {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(keypair.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, data, key);
}
export function addresses(program, domain, terms) {
  const le = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const [order] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      new PublicKey(terms.merchant).toBuffer(),
      Buffer.from(terms.id),
      new PublicKey(terms.mint || SystemProgram.programId).toBuffer(),
      le(terms.amount),
      le(terms.reward),
      Buffer.from(domain, "hex"),
    ],
    new PublicKey(program),
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), order.toBuffer()],
    new PublicKey(program),
  );
  return { order, vault };
}
export function edInstruction(keypair, data) {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: keypair.publicKey.toBytes(),
    message: data,
    signature: signature(keypair, data),
  });
}
