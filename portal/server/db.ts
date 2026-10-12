import { Pool, type PoolClient } from "pg";
import { explicitDatabaseTls } from "./database-connection";
let pool: Pool | undefined;
export function database() {
  if (!process.env.DATABASE_URL)
    throw Error("Shared database is not configured.");
  return (pool ??= new Pool({
    connectionString: explicitDatabaseTls(process.env.DATABASE_URL),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  }));
}
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
