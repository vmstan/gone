import assert from "node:assert/strict";
import test from "node:test";

import { createRetirementPage } from "../page.js";
import { classifyRequest, handleRequest } from "../router.js";

const retirementPage = createRetirementPage("<svg></svg>", "vmst.io");

function request(path, init = {}) {
  return handleRequest(new Request(`https://retired.example${path}`, init), retirementPage);
}

test("known machine paths return the shared JSON 410", async () => {
  const paths = [
    "/.well-known/host-meta",
    "/.well-known/webfinger",
    "/api/v1/instance",
    "/nodeinfo/2.0",
    "/oauth/token",
    "/statuses/123.json",
    "/@alice.rss",
    "/users/alice/inbox",
  ];

  for (const path of paths) {
    const response = request(path, { headers: { Accept: "image/png" } });
    assert.equal(response.status, 410, path);
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8", path);
    assert.equal(await response.text(), '{"error":"Gone"}\n', path);
  }
});

test("media paths return an empty 410 before considering Accept", async () => {
  for (const path of ["/media_proxy/123", "/media_attachments/1/image.png", "/system/file.mp4"]) {
    const response = request(path, { headers: { Accept: "application/json" } });
    assert.equal(response.status, 410, path);
    assert.equal(response.headers.get("Content-Type"), null, path);
    assert.equal(await response.text(), "", path);
  }
});

test("Accept is a coarse fallback for otherwise unknown paths", async () => {
  const machine = request("/profile", { headers: { Accept: "application/activity+json" } });
  const media = request("/attachment", { headers: { Accept: "image/webp" } });
  const browser = request("/attachment", {
    headers: { Accept: "text/html,application/json;q=0,image/webp" },
  });

  assert.equal(machine.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(media.headers.get("Content-Type"), null);
  assert.equal(browser.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("Accept quality weights and rejections select the response class", () => {
  const activityPub = request("/profile", {
    headers: { Accept: 'application/activity+json, application/ld+json;profile="x", text/html;q=0' },
  });
  const json = request("/profile", {
    headers: { Accept: "application/json;q=1, text/html;q=0.1" },
  });
  const media = request("/profile", {
    headers: { Accept: "application/json;q=0, image/png" },
  });
  const html = request("/profile", {
    headers: { Accept: "application/json;q=0.5, text/html;q=0.8" },
  });

  assert.equal(activityPub.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(json.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(media.headers.get("Content-Type"), null);
  assert.equal(html.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("ActivityPub request bodies use the machine response", () => {
  const post = new Request("https://retired.example/profile", {
    method: "POST",
    headers: { "Content-Type": "application/ld+json" },
    body: "{}",
  });
  const get = new Request("https://retired.example/profile", {
    headers: { "Content-Type": "application/ld+json" },
  });

  assert.equal(classifyRequest(post, "/profile"), "machine");
  assert.equal(classifyRequest(get, "/profile"), "html");
});

test("the retirement page has document protections", async () => {
  const response = request("/");

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, noarchive, nosnippet");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(await response.text(), retirementPage);
  assert.match(retirementPage, /vmst\.io is HTTP 410 \(Gone\)/);
  assert.match(retirementPage, /data:image\/svg\+xml;base64,PHN2Zz48L3N2Zz4=/);
  assert.doesNotMatch(retirementPage, /retired\.example/);
  assert.doesNotMatch(retirementPage, /__(?:DOMAIN|LOGO_DATA)__/);
});

test("all gone responses share cache, CORS, and safety headers", () => {
  const responses = [request("/"), request("/api/v1/instance"), request("/image.png")];

  for (const response of responses) {
    assert.equal(response.headers.get("Cache-Control"), "private, max-age=86400");
    assert.equal(response.headers.get("Cloudflare-CDN-Cache-Control"), "public, max-age=2592000");
    assert.equal(response.headers.get("Vary"), "Accept");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  }
});

test("robots and health remain live endpoints", async () => {
  const robots = request("/robots.txt");
  const health = request("/healthz");

  assert.equal(robots.status, 200);
  assert.equal(robots.headers.get("Cache-Control"), "public, max-age=86400");
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("Cache-Control"), "no-store");
  assert.equal(await health.text(), "ok\n");
});

test("CORS preflights succeed and echo requested headers", () => {
  const response = request("/api/v1/timelines/home", {
    method: "OPTIONS",
    headers: {
      Origin: "https://elk.zone",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "authorization");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("the canvas disintegration effect remains in the retirement page", () => {
  assert.match(retirementPage, /illustration-overlay/);
  assert.match(retirementPage, /function buildTiles\(\)/);
  assert.match(retirementPage, /requestAnimationFrame\(loop\)/);
  assert.match(retirementPage, /prefers-reduced-motion/);
});

test("page rendering escapes domains and inserts replacement tokens literally", () => {
  const page = createRetirementPage("<svg></svg>", `site<&"'$&`);

  assert.match(page, /site&lt;&amp;&#34;&#39;\$&amp; is HTTP 410 \(Gone\)/);
  assert.doesNotMatch(page, /site<&/);
  assert.doesNotMatch(page, /__(?:DOMAIN|LOGO_DATA)__/);
});
