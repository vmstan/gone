import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Wrangler resolves `.svg` imports at build time; stub them so the real
// worker entry can load under plain `node --test`.
register("../test-support/svg-loader.mjs", import.meta.url);

const { default: worker } = await import("../worker.js");

test("the worker entry serves gone responses and live endpoints", async () => {
  const gone = worker.fetch(new Request("https://vmst.io/"));
  assert.equal(gone.status, 410);
  assert.equal(gone.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(gone.headers.get("Access-Control-Allow-Origin"), "*");

  const machine = worker.fetch(new Request("https://vmst.io/api/v1/instance"));
  assert.equal(machine.status, 410);
  assert.equal(await machine.text(), '{"error":"Gone"}\n');

  const health = worker.fetch(new Request("https://vmst.io/healthz"));
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok\n");
});

test("the worker entry wires the production domain into the retirement page", async () => {
  const body = await worker.fetch(new Request("https://vmst.io/")).text();

  assert.match(body, /vmst\.io is HTTP 410 \(Gone\)/);
  assert.match(body, /data:image\/svg\+xml;base64,/);
});

test("the worker entry maps handler failures to a logged 500", async () => {
  const original = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const throwing = {
      get url() {
        throw new Error("boom");
      },
    };
    const response = worker.fetch(throwing);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), '{"error":"Internal Server Error"}');
    assert.deepEqual(JSON.parse(logged[0]), { message: "request failed", error: "boom" });

    const nonError = {
      get url() {
        throw "string boom";
      },
    };
    const second = worker.fetch(nonError);
    assert.equal(second.status, 500);
    assert.deepEqual(JSON.parse(logged[1]), { message: "request failed", error: "string boom" });
  } finally {
    console.error = original;
  }
});
