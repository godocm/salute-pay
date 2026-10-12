import { Buffer } from "buffer";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { z } from "zod";
const uint = z.string().regex(/^\d{1,78}$/);
export const paymentSchema = z.object({
  version: z.literal(4),
  network: z.object({
    chain: z.string().max(30),
    chainId: z.string().max(32),
    deployment: z.string().max(80),
    token: z.string().max(80),
    domain: z.string().max(64),
    feeToken: z.string().max(80).optional(),
  }),
  terms: z.object({
    id: z.string().regex(/^0x[\da-f]{64}$/i),
    merchant: z.string().max(80),
    token: z.string().max(80),
    amount: uint,
    executorFee: uint,
    originChainId: uint.optional(),
  }),
  address: z.string().max(80),
  signature: z
    .string()
    .regex(/^0x[\da-f]+$/i)
    .max(2048),
  reference: z.string().max(80),
  asset: z.string().max(16),
  decimals: z.number().int().min(0).max(18),
  createdAt: z.string().datetime(),
  webhookEnabled: z.boolean().optional(),
  publicListing: z.boolean().optional(),
});
export type Payment = ReturnType<typeof paymentSchema.parse>;
export function solMessage(
  n: { domain: string; deployment: string },
  t: Payment["terms"],
) {
  return new TextEncoder().encode(
    `Salute Payment Intent\nNetwork: ${n.domain}\nProgram: ${n.deployment}\nOrder: ${t.id.slice(2)}\nMerchant: ${t.merchant}\nMint: ${t.token}\nAmount: ${t.amount}\nExecutor reward: ${t.executorFee}\n`,
  );
}
export function solAddresses(
  n: { deployment: string; domain: string },
  t: Payment["terms"],
) {
  const u64 = (s: string) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(s));
    return b;
  };
  const program = new PublicKey(n.deployment),
    merchant = new PublicKey(t.merchant),
    mint = new PublicKey(t.token);
  const [order] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      merchant.toBuffer(),
      Buffer.from(t.id.slice(2), "hex"),
      mint.toBuffer(),
      u64(t.amount),
      u64(t.executorFee),
      Buffer.from(n.domain, "hex"),
    ],
    program,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), order.toBuffer()],
    program,
  );
  const ata = getAssociatedTokenAddressSync(mint, vault, true);
  return { program, merchant, mint, order, vault, ata };
}
export const nativeSol = SystemProgram.programId.toBase58();
