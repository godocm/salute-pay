import { createHmac } from "node:crypto";
import { database, transaction } from "./db";
import { random, deliverHttps } from "./security";
export async function sendWebhooks(sender = deliverHttps) {
  const claimed = await transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT w.*,m.webhook_url,m.webhook_secret FROM salute_webhooks w JOIN salute_merchants m ON m.id=w.merchant_id WHERE delivered_at IS NULL AND NOT dead AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY next_attempt_at LIMIT 20 FOR UPDATE OF w SKIP LOCKED",
    );
    for (const r of rows)
      await c.query(
        "UPDATE salute_webhooks SET locked_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=$1",
        [r.id],
      );
    return rows;
  });
  let delivered = 0;
  for (const r of claimed) {
    const timestamp = Math.floor(Date.now() / 1000).toString(),
      payload = JSON.stringify({
        id: r.id,
        createdAt: r.payload.createdAt || new Date().toISOString(),
        ...r.payload,
      });
    const signature = createHmac("sha256", r.webhook_secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    let status = 0;
    try {
      if (r.webhook_url)
        status = await sender(r.webhook_url, payload, {
          "salute-event-id": r.id,
          "salute-timestamp": timestamp,
          "salute-signature": `v1=${signature}`,
        });
    } catch {
      /* Persist retry without logging secrets or webhook bodies. */
    }
    const success = status >= 200 && status < 300,
      attempt = r.attempts + 1,
      delay = Math.min(3600, 15 * 2 ** Math.min(attempt, 8));
    await database().query(
      "UPDATE salute_webhooks SET delivered_at=CASE WHEN $2 THEN now() ELSE NULL END,locked_until=NULL,last_status=$3,dead=$4,next_attempt_at=now()+($5::int*interval '1 second') WHERE id=$1",
      [r.id, success, status, attempt >= 8 && !success, delay],
    );
    if (success) delivered++;
  }
  return { attempted: claimed.length, delivered };
}
export async function enqueue(
  c: import("pg").PoolClient,
  r: Record<string, any>,
  type: string,
  data: unknown,
) {
  if (!r.webhook_enabled) return;
  await c.query(
    "INSERT INTO salute_webhooks(id,merchant_id,slug,payload) VALUES($1,$2,$3,$4)",
    [
      random(),
      r.merchant_id,
      r.slug,
      JSON.stringify({
        type,
        createdAt: new Date().toISOString(),
        payment: data,
      }),
    ],
  );
}
