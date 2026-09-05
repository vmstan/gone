import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("production Worker runtime", () => {
  it("serves every response class through workerd with the real SVG asset", async () => {
    const html = await exports.default.fetch("https://vmst.io/");
    expect(html.status).toBe(410);
    expect(html.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const page = await html.text();
    expect(page).toContain("vmst.io is HTTP 410 (Gone)");

    const encodedLogo = page.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)?.[1];
    expect(encodedLogo).toBeDefined();
    const logo = new TextDecoder().decode(
      Uint8Array.from(atob(encodedLogo), (character) => character.charCodeAt(0))
    );
    expect(logo).toContain('<svg width="75" height="79"');
    expect(logo).toContain("linearGradient");

    const machine = await exports.default.fetch("https://vmst.io/api/v1/instance", {
      headers: { Accept: "image/png" },
    });
    expect(machine.status).toBe(410);
    expect(await machine.text()).toBe('{"error":"Gone"}\n');

    const media = await exports.default.fetch("https://vmst.io/image.png", {
      headers: { Accept: "application/json" },
    });
    expect(media.status).toBe(410);
    expect(await media.text()).toBe("");

    const health = await exports.default.fetch("https://vmst.io/healthz");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok\n");

    const preflight = await exports.default.fetch("https://vmst.io/api/v1/instance", {
      method: "OPTIONS",
      headers: {
        Origin: "https://elk.zone",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
