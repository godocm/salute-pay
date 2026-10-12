import { readFile } from "node:fs/promises";
import { Pool } from "pg";
if (!process.env.DATABASE_URL) throw Error("Set server-only DATABASE_URL.");
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await p.query(
    await readFile(
      new URL("../db/migrations/001_main.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log("Main payment schema migrated. Existing records preserved.");
} finally {
  await p.end();
}
