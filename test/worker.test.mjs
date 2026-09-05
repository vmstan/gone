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
  assert.equal(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
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
  assert.equal(robots.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("Cache-Control"), "no-store");
  assert.equal(health.headers.get("Content-Type"), "text/plain; charset=utf-8");
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

test("malformed Accept quality values are treated as rejected", () => {
  const notANumber = request("/profile", { headers: { Accept: "application/json;q=bogus" } });
  const tooLarge = request("/profile", { headers: { Accept: "application/json;q=2" } });
  const negative = request("/profile", { headers: { Accept: "text/html;q=-0.5" } });

  for (const response of [notANumber, tooLarge, negative]) {
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  }
});

test("non-GET requests without a Content-Type do not use the machine response", () => {
  const post = new Request("https://retired.example/profile", { method: "POST" });

  assert.equal(classifyRequest(post, "/profile"), "html");
});

test("HEAD requests never use the machine body rule", () => {
  const head = new Request("https://retired.example/profile", {
    method: "HEAD",
    headers: { "Content-Type": "application/activity+json" },
  });

  assert.equal(classifyRequest(head, "/profile"), "html");
});

test("machine bodies match content types with parameters and casing", () => {
  for (const contentType of [
    "application/json; charset=utf-8",
    "Application/LD+JSON",
    "application/activity+json; charset=utf-8",
  ]) {
    const req = new Request("https://retired.example/profile", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: "{}",
    });
    assert.equal(classifyRequest(req, "/profile"), "machine", contentType);
  }

  const plain = new Request("https://retired.example/profile", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "hi",
  });
  assert.equal(classifyRequest(plain, "/profile"), "html");
});

test("unknown or fully rejected Accept types fall back to the retirement page", () => {
  const unknown = request("/profile", { headers: { Accept: "text/plain" } });
  const wildcard = request("/profile", { headers: { Accept: "*/*" } });
  const allRejected = request("/profile", {
    headers: { Accept: "text/html;q=0, application/json;q=0, image/png;q=0" },
  });

  for (const response of [unknown, wildcard, allRejected]) {
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  }
});

test("machine responses win ties against media but lose them to html", () => {
  const machineOverMedia = request("/profile", {
    headers: { Accept: "application/json, image/png" },
  });
  const htmlOverMachine = request("/profile", {
    headers: { Accept: "text/html, application/json" },
  });

  assert.equal(machineOverMedia.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(htmlOverMachine.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("Accept types and media extensions match case-insensitively", () => {
  const upper = request("/profile", { headers: { Accept: "TEXT/HTML" } });
  const photo = request("/PHOTO.JPG");

  assert.equal(upper.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(photo.headers.get("Content-Type"), null);
});

test("remaining well-known and oauth paths return the shared JSON 410", async () => {
  for (const path of [
    "/.well-known/nodeinfo",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known/x-nodeinfo2",
    "/oauth/revoke",
    "/oauth/userinfo",
  ]) {
    const response = request(path);
    assert.equal(response.status, 410, path);
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8", path);
    assert.equal(await response.text(), '{"error":"Gone"}\n', path);
  }
});

test("live endpoints ignore query strings but not extra path segments", () => {
  assert.equal(request("/healthz?ready=1").status, 200);
  assert.equal(request("/robots.txt?x=1").status, 200);
  assert.equal(request("/healthz/").status, 410);
  assert.equal(request("/robots.txt/").status, 410);
});

test("safe headers apply to live endpoints and preflights too", () => {
  const responses = [
    request("/healthz"),
    request("/robots.txt"),
    request("/api/v1/instance", {
      method: "OPTIONS",
      headers: {
        Origin: "https://elk.zone",
        "Access-Control-Request-Method": "GET",
      },
    }),
  ];

  for (const response of responses) {
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
});

test("preflights without requested headers still succeed", async () => {
  const response = request("/api/v1/instance", {
    method: "OPTIONS",
    headers: {
      Origin: "https://elk.zone",
      "Access-Control-Request-Method": "GET",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), null);
  assert.equal(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "");
});

test("OPTIONS requests missing either required CORS header are not preflights", () => {
  const missingOrigin = request("/profile", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "GET" },
  });
  const missingRequestedMethod = request("/profile", {
    method: "OPTIONS",
    headers: { Origin: "https://elk.zone" },
  });

  for (const response of [missingOrigin, missingRequestedMethod]) {
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  }
});

test("live endpoints only accept GET and HEAD", () => {
  for (const path of ["/healthz", "/robots.txt"]) {
    assert.equal(request(path, { method: "GET" }).status, 200, path);
    assert.equal(request(path, { method: "HEAD" }).status, 200, path);
    assert.equal(request(path, { method: "POST" }).status, 410, path);
    assert.equal(request(path, { method: "PUT" }).status, 410, path);
  }
});

test("page rendering escapes every special character in the title and heading", () => {
  const page = createRetirementPage("<svg></svg>", `a>b<&"'`);

  assert.match(page, /<title>a&gt;b&lt;&amp;&#34;&#39;<\/title>/);
  assert.match(page, /a&gt;b&lt;&amp;&#34;&#39; is HTTP 410 \(Gone\)/);
});

test("logos with non-ASCII bytes survive the base64 round trip", () => {
  const logo = "<svg><!-- héllo 🌍 --></svg>";
  const page = createRetirementPage(logo, "vmst.io");
  const encoded = page.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)[1];
  const decoded = new TextDecoder().decode(
    Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
  );

  assert.equal(decoded, logo);
});
