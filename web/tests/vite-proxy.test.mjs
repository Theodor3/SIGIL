// Checks the dev-server proxy table Vite actually resolves from vite.config.ts.
//
// This asks Vite to load and resolve the config, then reads the result. It does
// not start the dev server, a backend or a socket, and makes no network call --
// so it proves what the dev server is configured to forward, not that a request
// is routed end to end.
//
//   cd web && node --test tests/vite-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = await resolveConfig(
  { root, configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)), logLevel: "silent" },
  "serve",
  "development",
);
const proxy = config.server.proxy ?? {};

/** Vite accepts a bare target string or an options object; compare as options. */
const rule = (key) => {
  const value = proxy[key];
  return typeof value === "string" ? { target: value } : value;
};
const endpoint = (target) => {
  const url = new URL(target);
  return { protocol: url.protocol, hostname: url.hostname, port: url.port };
};

test("dev server keeps its host and port", () => {
  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.server.port, 3000);
});

test("/api and /health still forward over HTTP to the local backend", () => {
  for (const key of ["/api", "/health"]) {
    assert.ok(rule(key), `${key} has a proxy rule`);
    assert.deepEqual(endpoint(rule(key).target), {
      protocol: "http:",
      hostname: "localhost",
      port: "8000",
    });
    assert.ok(!rule(key).ws, `${key} is not a WebSocket rule`);
  }
});

test("/ws forwards WebSocket upgrades to the same local backend", () => {
  const ws = rule("/ws");
  assert.ok(ws, "/ws has a proxy rule");
  assert.equal(ws.ws, true, "WebSocket forwarding is enabled");

  const target = endpoint(ws.target);
  assert.ok(["ws:", "http:"].includes(target.protocol), `unexpected protocol ${target.protocol}`);
  assert.equal(target.hostname, "localhost");
  assert.equal(target.port, "8000");

  const http = endpoint(rule("/api").target);
  assert.equal(`${target.hostname}:${target.port}`, `${http.hostname}:${http.port}`);
});

test("only the three backend paths are proxied", () => {
  assert.deepEqual(Object.keys(proxy).sort(), ["/api", "/health", "/ws"]);
});
