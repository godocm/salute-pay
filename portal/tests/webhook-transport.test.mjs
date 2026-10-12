import test from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";
import { pinnedLookup } from "../server/pinned-lookup.ts";

for (const autoSelectFamily of [true, false]) {
  test(`pinned webhook socket lookup connects with autoSelectFamily=${autoSelectFamily}`, async () => {
    const server = createServer((socket) => socket.end("connected"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const lookup = pinnedLookup([
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const socket = createConnection({
      host: "merchant.example.test", port: server.address().port,
      autoSelectFamily, lookup,
    });
    socket.setTimeout(3000, () => socket.destroy(Error("Loopback socket timeout.")));
    try {
      const [data] = await once(socket, "data");
      assert.equal(data.toString(), "connected");
      assert.equal(socket.remoteAddress, "127.0.0.1");
    } finally {
      socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
