import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pg-connection-string";
import { explicitDatabaseTls } from "../server/database-connection.ts";

test("legacy TLS aliases retain certificate and hostname verification without changing credentials", () => {
  for (const mode of ["prefer", "require", "verify-ca"]) {
    const input = `postgresql://demo:encoded%40password@db.example.test/demo?sslmode=${mode}&channel_binding=require`,
      result = explicitDatabaseTls(input),
      url = new URL(result),
      config = parse(result);
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.searchParams.get("channel_binding"), "require");
    assert.equal(url.password, "encoded%40password");
    assert.equal(config.sslmode, "verify-full");
    assert.notEqual(config.ssl, false);
    assert.notEqual(config.ssl.rejectUnauthorized, false);
  }
});
test("loopback fixtures, explicit strict TLS and existing libpq options remain intact", () => {
  for (const input of [
    "postgresql://postgres:local-test@127.0.0.1:15432/salute_test",
    "postgresql://demo:test@db.example.test/demo?sslmode=verify-full",
    "postgresql://demo:test@db.example.test/demo?sslmode=require&uselibpqcompat=true",
  ])
    assert.equal(explicitDatabaseTls(input), input);
});
