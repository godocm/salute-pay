import { getAddress, verifyMessage } from "ethers";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { TronWeb } from "tronweb";
import { database, transaction } from "./db";
import { random, hash, HttpError } from "./security";
import evm from "../lib/evm-networks.json";
export function identity(chain: string, address: string) {
  const family = Object.hasOwn(evm, chain) ? "evm" : chain;
  if (family === "evm") address = getAddress(address).toLowerCase();
  else if (family === "solana") address = new PublicKey(address).toBase58();
  else if (family === "tron" && TronWeb.isAddress(address))
    address = TronWeb.address.fromHex(TronWeb.address.toHex(address));
  else throw new HttpError(400, "Invalid wallet family or address.");
  return { id: `${family}:${address}`, family, address };
}
export async function challenge(
  chain: string,
  address: string,
  origin: string,
) {
  const i = identity(chain, address),
    id = random(),
    expires = new Date(Date.now() + 300000);
  const message = `Salute Pay account access\nOrigin: ${origin}\nWallet: ${i.address}\nChain: ${chain}\nNonce: ${id}\nExpires: ${expires.toISOString()}\nThis signature creates an app session. It does not authorize transfers.`;
  await database().query(
    "INSERT INTO salute_challenges(id,merchant_id,address,chain,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [id, i.id, i.address, chain, message, expires],
  );
  return { id, message };
}
export async function authenticate(id: string, signature: string) {
  if (
    typeof id !== "string" ||
    typeof signature !== "string" ||
    signature.length > 1024
  )
    throw new HttpError(400, "Invalid authentication payload.");
  return transaction(async (c) => {
    const {
      rows: [r],
    } = await c.query(
      "SELECT * FROM salute_challenges WHERE id=$1 AND NOT used AND expires_at>now() FOR UPDATE",
      [id],
    );
    if (!r) throw new HttpError(401, "Challenge expired or consumed.");
    const i = identity(r.chain, r.address);
    let valid = false;
    try {
      if (i.family === "evm")
        valid = verifyMessage(r.message, signature).toLowerCase() === i.address;
      else if (i.family === "solana")
        valid = nacl.sign.detached.verify(
          new TextEncoder().encode(r.message),
          Buffer.from(signature.replace(/^0x/, ""), "hex"),
          new PublicKey(i.address).toBytes(),
        );
      else
        valid =
          (await new TronWeb({
            fullHost: "https://nile.trongrid.io",
          }).trx.verifyMessageV2(r.message, signature)) === i.address;
    } catch {
      /* Invalid signatures are rejected below. */
    }
    if (!valid) throw new HttpError(401, "Wallet signature did not match.");
    await c.query("UPDATE salute_challenges SET used=true WHERE id=$1", [id]);
    await c.query(
      "INSERT INTO salute_merchants(id,address,family,webhook_secret) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
      [i.id, i.address, i.family, random()],
    );
    const token = random();
    await c.query(
      "INSERT INTO salute_sessions(token_hash,merchant_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [hash(token), i.id],
    );
    return token;
  });
}
export async function session(req: Request) {
  const token = /salute_session=([^;]+)/.exec(
    req.headers.get("cookie") || "",
  )?.[1];
  if (!token) throw new HttpError(401, "Sign in with your wallet.");
  const {
    rows: [r],
  } = await database().query(
    "SELECT m.* FROM salute_sessions s JOIN salute_merchants m ON m.id=s.merchant_id WHERE token_hash=$1 AND expires_at>now()",
    [hash(token)],
  );
  if (!r) throw new HttpError(401, "Session expired.");
  return r;
}
export async function rateLimit(key: string, limit = 30) {
  const {
    rows: [r],
  } = await database().query(
    "INSERT INTO salute_rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN salute_rate_limits.expires_at<now() THEN 1 ELSE salute_rate_limits.count+1 END,expires_at=CASE WHEN salute_rate_limits.expires_at<now() THEN now()+interval '1 minute' ELSE salute_rate_limits.expires_at END RETURNING count",
    [key],
  );
  if (r.count > limit)
    throw new HttpError(429, "Too many requests. Try again shortly.");
}
