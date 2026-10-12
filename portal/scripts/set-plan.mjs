import { Pool } from "pg";
const [merchant, plan] = process.argv.slice(2);
if (
  !process.env.DATABASE_URL ||
  !merchant ||
  !["free", "growth", "scale"].includes(plan)
)
  throw Error("Set DATABASE_URL; usage: npm run plan:set -- evm:0x... growth");
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const r = await p.query("UPDATE salute_merchants SET plan=$2 WHERE id=$1", [
    merchant,
    plan,
  ]);
  if (r.rowCount !== 1) throw Error("Merchant must sign in first.");
  console.log(
    "Dashboard plan updated. Contract access remains permissionless.",
  );
} finally {
  await p.end();
}
