import { database } from "./db";
import { challenge, authenticate, session, rateLimit } from "./auth";
import {
  requireOrigin,
  body,
  HttpError,
  validateWebhook,
  cronAuthorized,
  hash,
} from "./security";
import { publicNetworks } from "./networks";
import { publish, payment, paymentView } from "./payments";
import { watch } from "./watcher";
import { sendWebhooks } from "./webhooks";
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
export async function api(req: Request) {
  try {
    const path = new URL(req.url).pathname.replace(/^\/api\//, ""),
      method = req.method;
    if (path === "networks" && method === "GET")
      return json({
        protocol: 4,
        networks: publicNetworks(),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
      });
    if (path === "jobs" && (method === "GET" || method === "POST")) {
      if (!cronAuthorized(req))
        throw new HttpError(401, "Job authorization required.");
      return json({ watcher: await watch(), webhooks: await sendWebhooks() });
    }
    if (["POST", "PUT", "DELETE"].includes(method)) requireOrigin(req);
    if (!process.env.DATABASE_URL)
      throw new HttpError(
        503,
        "Shared publishing is not configured. Signed offline links remain available.",
      );
    // Deployed proxies provide this header. Local development has a single conservative rate-limit bucket.
    const ip =
      req.headers.get("x-vercel-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "local";
    if (method !== "GET" || path === "public-orders")
      await rateLimit(hash(ip), 60);
    if (path === "auth/challenge" && method === "POST") {
      const b = await body(req);
      await rateLimit(`challenge:${String(b.address).toLowerCase()}`, 10);
      return json(
        await challenge(
          b.chain,
          b.address,
          process.env.APP_ORIGIN || new URL(req.url).origin,
        ),
      );
    }
    if (path === "auth/verify" && method === "POST") {
      const b = await body(req),
        token = await authenticate(b.id, b.signature);
      return json({ authenticated: true }, 200, {
        "set-cookie": `salute_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
      });
    }
    if (path === "auth/logout" && method === "POST") {
      const token = /salute_session=([^;]+)/.exec(
        req.headers.get("cookie") || "",
      )?.[1];
      if (token)
        await database().query(
          "DELETE FROM salute_sessions WHERE token_hash=$1",
          [hash(token)],
        );
      return json({ authenticated: false }, 200, {
        "set-cookie":
          "salute_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      });
    }
    if (path === "me" && method === "GET") {
      const m = await session(req),
        {
          rows: [usage],
        } = await database().query(
          "SELECT count(*)::int n FROM salute_payments WHERE merchant_id=$1 AND created_at>=date_trunc('month',now())",
          [m.id],
        );
      return json({
        address: m.address,
        family: m.family,
        plan: m.plan,
        webhookUrl: m.webhook_url || "",
        webhookSecret: m.webhook_secret,
        linksThisMonth: usage.n,
      });
    }
    if (path === "settings" && method === "PUT") {
      const m = await session(req),
        b = await body(req);
      if (typeof b.webhookUrl !== "string" || b.webhookUrl.length > 2048)
        throw new HttpError(400, "Invalid webhook URL.");
      const url = b.webhookUrl.trim()
        ? validateWebhook(b.webhookUrl.trim()).toString()
        : null;
      await database().query(
        "UPDATE salute_merchants SET webhook_url=$2 WHERE id=$1",
        [m.id, url],
      );
      return json({ webhookUrl: url || "" });
    }
    if (path === "payments" && method === "POST")
      return json(await publish(await body(req), await session(req)), 201);
    if (path === "payments" && method === "GET") {
      const m = await session(req),
        { rows } = await database().query(
          "SELECT * FROM salute_payments WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100",
          [m.id],
        );
      return json({ payments: rows.map(paymentView) });
    }
    if (path === "public-orders" && method === "GET") {
      const { rows } = await database().query(
        "SELECT * FROM salute_payments WHERE public_listing ORDER BY updated_at DESC LIMIT 100",
      );
      return json({ payments: rows.map(paymentView) });
    }
    const receipt = /^payments\/([\w-]{20,40})\/transactions$/.exec(path);
    if (receipt && method === "POST") {
      const i = await payment(receipt[1]),
        b = await body(req);
      if (
        typeof b.hash !== "string" ||
        !/^([0-9a-f]{64}|0x[0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{70,100})$/i.test(
          b.hash,
        ) ||
        typeof b.chain !== "string" ||
        !publicNetworks()[b.chain]
      )
        throw new HttpError(400, "Invalid transaction reference.");
      if (
        i.network.chain !== b.chain &&
        !Object.hasOwn(publicNetworks(), b.chain)
      )
        throw new HttpError(400, "Unsupported execution chain.");
      await database().query(
        "INSERT INTO salute_submitted_transactions(slug,chain,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [receipt[1], b.chain, b.hash],
      );
      return json({ queued: true }, 202);
    }
    const detail = /^payments\/([\w-]{20,40})$/.exec(path);
    if (detail && method === "GET") return json(await payment(detail[1]));
    throw new HttpError(404, "API route not found.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json(
      { error: "Operation failed. Verify configuration and try again." },
      500,
    );
  }
}
