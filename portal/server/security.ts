import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
export const random = () => randomBytes(24).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireOrigin(req: Request) {
  const expected = process.env.APP_ORIGIN || new URL(req.url).origin,
    origin = req.headers.get("origin");
  if (origin !== expected)
    throw new HttpError(403, "Use the configured app origin.");
}
export async function body(req: Request) {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "JSON body required.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Body required.");
  let bytes = 0,
    parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32768) {
      await reader.cancel();
      throw new HttpError(413, "Payload too large.");
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET,
    a = Buffer.from(req.headers.get("authorization") || ""),
    b = Buffer.from(`Bearer ${secret || ""}`);
  return Boolean(secret && a.length === b.length && timingSafeEqual(a, b));
}
export function validateWebhook(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Enter a valid webhook HTTPS URL.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== "443") ||
    isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".localhost")
  )
    throw new HttpError(
      400,
      "Webhook requires a public HTTPS hostname on port 443.",
    );
  return u;
}
export function publicAddress(raw: string) {
  try {
    const a = ipaddr.process(raw);
    return a.range() === "unicast";
  } catch {
    return false;
  }
}
export async function deliverHttps(
  raw: string,
  payload: string,
  headers: Record<string, string>,
) {
  const u = validateWebhook(raw),
    addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("Unsafe webhook destination.");
  const selected = addresses[0];
  // Pin the checked DNS answer in the socket lookup; retain hostname for TLS certificate verification.
  return new Promise<number>((resolve, reject) => {
    const r = httpsRequest(
      u,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        lookup: (_h, _o, cb) => cb(null, selected.address, selected.family),
        timeout: 8000,
      },
      (response) => {
        const status = response.statusCode || 0;
        response.destroy();
        resolve(status);
      },
    );
    r.on("timeout", () => r.destroy(Error("Webhook timeout.")));
    r.on("error", reject);
    r.end(payload);
  });
}
