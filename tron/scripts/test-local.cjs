// Use only the public, valueless development key from our named local TRE container.
const { spawnSync } = require("node:child_process");
const result = spawnSync("docker", ["logs", "salute-tron-main-test"], {
  encoding: "utf8",
});
const log = result.stdout + result.stderr;
const section = log.split("Private Keys")[1];
const key = section?.match(/(?:0x)?([a-fA-F0-9]{64})/)?.[1];
if (!key) throw Error("The isolated TRE container is not ready.");
const test = spawnSync(
  "npx",
  ["tronbox", "test", "test/collection.js", "--network", "development"],
  {
    cwd: require("node:path").resolve(__dirname, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      PRIVATE_KEY_DEV: key,
      TRON_FULL_NODE_URL: "http://127.0.0.1:9091",
    },
  },
);
process.exitCode = test.status || 0;
