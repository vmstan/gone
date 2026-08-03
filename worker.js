// Worker gone is a tiny Cloudflare Worker that responds to every request with
// HTTP 410 Gone and a self-contained page mirroring the Mastodon error page.
// Ported from main.go — see README.md for the content-negotiation rules.

import LOGO_SVG from "./logo.svg";

// displayDomain is intentionally fixed so the HTML response is identical
// across every hostname routed to this Worker and can be safely shared by
// Workers Cache, whose base cache key does not include the request host.
const displayDomain = "vmst.io";

const PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__DOMAIN__</title>
<style>
:root {
  --color-bg: #fff;
  --color-text: #21212c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #181820;
    --color-text: #f6f6f9;
  }
}
html, body { height: 100%; }
body {
  margin: 0;
  padding: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
}
.dialog { margin: 20px; }
.dialog__illustration canvas {
  width: 100%;
  max-width: 140px;
  height: auto;
  display: block;
  margin: 0 auto 24px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .dialog__illustration canvas { cursor: default; }
}
.dialog h1 {
  font-size: 20px;
  font-weight: 400;
  line-height: 28px;
}
</style>
</head>
<body>
<div class="dialog">
<div class="dialog__illustration">
<canvas id="illustration" role="img" aria-label="Mastodon"></canvas>
</div>
<div class="dialog__message">
<h1>__DOMAIN__ is HTTP 410 (Gone)</h1>
</div>
</div>
<canvas id="illustration-overlay" style="position:fixed; top:0; left:0; width:100vw; height:100vh; pointer-events:none; z-index:9999;"></canvas>
<script>
(function () {
  var canvas = document.getElementById('illustration');
  var ctx = canvas.getContext('2d');
  var overlay = document.getElementById('illustration-overlay');
  var octx = overlay.getContext('2d');
  var img = new Image();
  img.src = 'data:image/svg+xml;base64,__LOGO_DATA__';

  // The logo is vector art rasterized at RENDER_SCALE times its intrinsic
  // size, so it stays crisp at the canvas's actual pixel resolution rather
  // than the small source dimensions in the SVG's width/height attributes.
  var RENDER_SCALE = 6;
  // Tile size is in on-screen pixels, converted to canvas pixels at build
  // time. In canvas pixels the tile count would scale with RENDER_SCALE
  // squared, so a crisper raster would silently cost 36x the draw calls.
  var TILE_DISPLAY_SIZE = 8;
  var tiles = [];
  var builtTileSize = 0;
  var builtWidth = 0;
  var builtHeight = 0;
  var progress = 0; // 0 = intact, 1 = fully dissolved; only ever increases
  var target = 0;
  var speed = 1 / 6000; // progress units per ms — a slow, wind-borne drift
  var lastTs = null;
  var running = false;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  // Canvas pixels to the CSS pixels the canvas occupies. Before layout the
  // rect is empty, so fall back to the ratio the canvas is authored at.
  function displayScale() {
    var rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? rect.width / canvas.width : 1 / RENDER_SCALE;
  }

  function buildTiles() {
    var tileSize = Math.max(1, Math.round(TILE_DISPLAY_SIZE / displayScale()));
    // The canvas dimensions are part of the guard, not just the tile size. A
    // resize landing before the logo loads builds a grid against the
    // placeholder canvas, and keying on tile size alone could then skip the
    // rebuild once the real dimensions arrive, leaving part of the logo
    // outside the grid and unable to ever dissolve.
    if (
      tiles.length &&
      tileSize === builtTileSize &&
      canvas.width === builtWidth &&
      canvas.height === builtHeight
    ) {
      return;
    }
    builtTileSize = tileSize;
    builtWidth = canvas.width;
    builtHeight = canvas.height;
    var cols = Math.ceil(canvas.width / tileSize);
    var rows = Math.ceil(canvas.height / tileSize);
    tiles = [];
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        tiles.push({
          x: x * tileSize,
          y: y * tileSize,
          w: Math.min(tileSize, canvas.width - x * tileSize),
          h: Math.min(tileSize, canvas.height - y * tileSize),
          delay: (x / cols) * 0.5 + Math.random() * 0.3,
          // A shared rightward breeze (with per-tile jitter) rather than an
          // outward blast, plus a gentle rise and a perpendicular sway so
          // tiles flutter like leaves caught in the wind. Drift is kept as a
          // fraction of the viewport and resolved at draw time, so a resize
          // re-aims the wind without re-rolling it.
          windXFactor: 0.45 + Math.random() * 0.5,
          windYFactor: 0.1 + Math.random() * 0.25,
          sway: 15 + Math.random() * 25,
          swayFreq: 1.2 + Math.random() * 1.8,
          swayPhase: Math.random() * Math.PI * 2,
          rot: (Math.random() - 0.5) * 2.2
        });
      }
    }
  }

  function resizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
  }

  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    octx.clearRect(0, 0, overlay.width, overlay.height);

    // A faint grayscale ghost of the original logo, left behind under
    // whatever hasn't dissolved away yet.
    if (progress > 0) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.filter = 'grayscale(100%)';
      ctx.drawImage(img, 0, 0, canvas.width / RENDER_SCALE, canvas.height / RENDER_SCALE, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    var rect = canvas.getBoundingClientRect();
    var scale = rect.width / canvas.width;
    var originX = rect.left, originY = rect.top;
    var windX = window.innerWidth, windY = -window.innerHeight;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var span = 1 - t.delay;
      var p = span > 0 ? (progress - t.delay) / span : progress > t.delay ? 1 : 0;
      p = Math.min(Math.max(p, 0), 1);
      if (p >= 1) continue;
      if (p <= 0) {
        ctx.drawImage(img, t.x / RENDER_SCALE, t.y / RENDER_SCALE, t.w / RENDER_SCALE, t.h / RENDER_SCALE, t.x, t.y, t.w, t.h);
        continue;
      }
      var sway = Math.sin(p * t.swayFreq * Math.PI + t.swayPhase) * t.sway * p;
      octx.save();
      octx.globalAlpha = 1 - p;
      octx.translate(
        originX + (t.x + t.w / 2) * scale + windX * t.windXFactor * p + sway,
        originY + (t.y + t.h / 2) * scale + windY * t.windYFactor * p
      );
      octx.rotate(t.rot * p + Math.sin(p * t.swayFreq * Math.PI + t.swayPhase) * 0.25);
      var dw = t.w * scale, dh = t.h * scale;
      octx.drawImage(img, t.x / RENDER_SCALE, t.y / RENDER_SCALE, t.w / RENDER_SCALE, t.h / RENDER_SCALE, -dw / 2, -dh / 2, dw, dh);
      octx.restore();
    }
  }

  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    if (progress < target) {
      progress = Math.min(target, progress + dt * speed);
    }
    drawFrame();
    if (progress !== target) {
      requestAnimationFrame(loop);
    } else {
      running = false;
      lastTs = null;
    }
  }

  function setTarget(t) {
    if (reducedMotion && reducedMotion.matches) return;
    target = t;
    if (!running) {
      running = true;
      lastTs = null;
      requestAnimationFrame(loop);
    }
  }

  img.onload = function () {
    canvas.width = img.naturalWidth * RENDER_SCALE;
    canvas.height = img.naturalHeight * RENDER_SCALE;
    resizeOverlay();
    buildTiles();
    drawFrame();
  };

  window.addEventListener('resize', function () {
    resizeOverlay();
    // Rebuilding re-rolls each tile's delay and drift, so tiles already in
    // flight would jump; only rebuild while the logo is still intact.
    // drawFrame picks up the new scale and wind either way.
    if (progress === 0) buildTiles();
    drawFrame();
  });

  canvas.addEventListener('mouseenter', function () { setTarget(1); });
  canvas.addEventListener('click', function () { setTarget(1); });
})();
</script>
</body>
</html>
`;

// toBase64 encodes a UTF-8 string as base64 without relying on Node's Buffer,
// which isn't available in the Workers runtime by default.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// pageTpl is the self-contained HTML with the logo inlined as a data URI,
// computed once per isolate (mirroring Go's package-level init()). The
// __DOMAIN__ placeholder is filled per request with the requested host, so a
// single deployment can serve any number of domains.
const pageTpl = PAGE_TEMPLATE.replace("__LOGO_DATA__", toBase64(LOGO_SVG));

// escapeHTML escapes the five characters html.EscapeString covers, since the
// domain is interpolated into the page.
function escapeHTML(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;");
}

// rawHost returns the host Cloudflare used to route the request. Deriving it
// from the URL avoids reflecting a client-supplied X-Forwarded-Host header in
// the request log. It may still include a port in local development.
function rawHost(request) {
  return new URL(request.url).host;
}

// mediaRanges parses the parts of an Accept header that are relevant to
// content negotiation. A malformed or out-of-range q value makes that range
// unacceptable rather than accidentally selecting it.
function mediaRanges(headerValue) {
  return (headerValue || "").split(",").map((range) => {
    const [rawType, ...parameters] = range.trim().split(";");
    let quality = 1;
    for (const parameter of parameters) {
      const [name, value] = parameter.split("=", 2);
      if (name.trim().toLowerCase() !== "q") continue;
      const q = Number(value && value.trim());
      quality = Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
    }
    return { type: rawType.trim().toLowerCase(), quality };
  });
}

// qualityForAny returns the highest quality assigned to any of the given
// media types. Matching the parsed type avoids treating a parameter value as
// a representation, and lets callers compare the client's actual weights
// instead of allowing the first positive range to win.
function qualityForAny(headerValue, ...mediaTypes) {
  const wanted = new Set(mediaTypes.map((mediaType) => mediaType.toLowerCase()));
  return mediaRanges(headerValue).reduce(
    (best, { type, quality }) => (wanted.has(type) ? Math.max(best, quality) : best),
    0
  );
}

// bestAcceptedRange returns the highest-quality positive range matching the
// predicate. Array order breaks equal-quality ties, preserving the order in
// which the client listed otherwise-equivalent choices.
function bestAcceptedRange(headerValue, predicate) {
  let best = null;
  for (const range of mediaRanges(headerValue)) {
    if (range.quality <= 0 || !predicate(range.type)) continue;
    if (best === null || range.quality > best.quality) best = range;
  }
  return best;
}

// contentTypeIsAny checks the single media type in a Content-Type header.
// Unlike Accept, Content-Type has no quality values and must not be parsed as
// a comma-separated preference list.
function contentTypeIsAny(headerValue, ...mediaTypes) {
  const type = (headerValue || "").split(";", 1)[0].trim().toLowerCase();
  return mediaTypes.some((mediaType) => type === mediaType.toLowerCase());
}

// isHostMetaPath reports whether the request targets the host-meta discovery
// document (RFC 6415) that bootstraps WebFinger. It is served as XRD XML.
function isHostMetaPath(p) {
  return p === "/.well-known/host-meta";
}

// isNodeInfoPath reports whether the request targets NodeInfo discovery or a
// NodeInfo document. Fediverse crawlers and stats sites probe these heavily,
// often without a useful Accept header, so the path is the signal.
function isNodeInfoPath(p) {
  return p === "/.well-known/nodeinfo" || p === "/.well-known/x-nodeinfo2" || p.startsWith("/nodeinfo/");
}

// isJSONDiscoveryPath reports whether the request targets a fediverse JSON
// discovery endpoint (WebFinger, NodeInfo, or OAuth/OIDC server metadata)
// that should answer with JSON regardless of the Accept header.
function isJSONDiscoveryPath(p) {
  return (
    p === "/.well-known/webfinger" ||
    p === "/.well-known/oauth-authorization-server" ||
    p === "/.well-known/openid-configuration" ||
    isNodeInfoPath(p)
  );
}

// isOAuthJSONPath reports whether the request targets an OAuth/OIDC endpoint
// whose clients are machine callers expecting JSON — token exchange,
// revocation, and OIDC userinfo — as opposed to /oauth/authorize, which is
// the interactive browser login page and should still get the HTML page.
// OAuth client libraries often POST to these without an explicit Accept
// header, so the path is the reliable signal.
function isOAuthJSONPath(p) {
  return p === "/oauth/token" || p === "/oauth/revoke" || p === "/oauth/userinfo";
}

// isAPIPath reports whether the request targets the Mastodon REST API. Its
// clients are human-facing apps (the official web UI and third-party
// clients) that read the JSON error's "error" field to show the user an
// alert.
function isAPIPath(p) {
  return p.startsWith("/api/");
}

// isJSONPath reports whether the request should get a JSON response
// regardless of the Accept header: fediverse JSON discovery, OAuth/OIDC
// machine endpoints, and any .json resource.
function isJSONPath(p) {
  return isJSONDiscoveryPath(p) || isOAuthJSONPath(p) || p.endsWith(".json");
}

// isFeedPath reports whether the request is for Mastodon's RSS feed — the
// only syndication format it serves (there is no Atom equivalent).
function isFeedPath(p) {
  return p.endsWith(".rss");
}

// isInboxPath reports whether the request targets an ActivityPub inbox (the
// shared /inbox or a per-actor /users/x/inbox). Federation delivery POSTs land
// here; the delivering server only needs the 410 status to stop delivering, so
// these get an empty body.
function isInboxPath(p) {
  return p.endsWith("/inbox");
}

// hasActivityPubContentType identifies ActivityPub request bodies. This is a
// stronger signal than Accept: inbox deliveries may omit Accept entirely, and
// their request representation should not be reclassified by response weights.
//
// Content-Type describes a request body, so it is only meaningful on methods
// that carry one. Ignoring it on GET and HEAD keeps every cacheable response a
// function of Accept alone, which is what lets Vary stay a single header —
// Workers Cache stores one variant per distinct value of every header named in
// Vary, so each extra name multiplies the number of stored variants.
function hasActivityPubContentType(request) {
  if (request.method === "GET" || request.method === "HEAD") return false;
  return contentTypeIsAny(
    request.headers.get("Content-Type"),
    "application/activity+json",
    "application/ld+json"
  );
}

// preferredMachineRepresentation compares the recognized non-media response
// types in Accept. Path-based responses are handled separately. Equal weights
// retain the existing server preference for ActivityPub, then generic JSON.
function preferredMachineRepresentation(headerValue) {
  const activityPubQuality = qualityForAny(headerValue, "application/activity+json", "application/ld+json");
  const jsonQuality = qualityForAny(headerValue, "application/json", "application/jrd+json");
  const htmlQuality = qualityForAny(headerValue, "text/html");

  if (activityPubQuality > 0 && activityPubQuality >= jsonQuality && activityPubQuality >= htmlQuality) {
    return "activitypub";
  }
  if (jsonQuality > 0 && jsonQuality >= htmlQuality) return "json";
  return "";
}

// mediaExts maps a media file extension to the Content-Type a bucket of
// images/attachments would have served it as.
const mediaExts = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".heic", "image/heic"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".ogv", "video/ogg"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".wav", "audio/wav"],
  [".flac", "audio/flac"],
]);

function extOf(p) {
  const slash = p.lastIndexOf("/");
  const base = slash === -1 ? p : p.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function isMediaType(type) {
  return /^(?:image|video|audio)\/(?:[a-z0-9!#$&^_.+-]+|\*)$/.test(type);
}

// bestAcceptedMediaRange returns the highest-quality image/video/audio range.
// It can preserve a wildcard so callers can recognize an extensionless media
// request even though a wildcard is not a concrete response Content-Type.
function bestAcceptedMediaRange(headerValue, concreteOnly = false) {
  return bestAcceptedRange(headerValue, (type) => isMediaType(type) && (!concreteOnly || !type.endsWith("/*")));
}

// Media requests are what a decommissioned S3 bucket of attachments would
// receive: <img>/<video> subresources or server-side refetches that discard
// any HTML body, so they get an empty 410 to save bandwidth. Detection splits
// in two, because the path is authoritative and the Accept header is only a
// tie-breaker for paths that carry no signal of their own.

// isMediaPath reports whether the path alone identifies media: a known
// Mastodon media prefix (frequently extensionless, e.g. a hotlinked
// /media_proxy/… image) or a known media file extension.
function isMediaPath(p) {
  if (p.startsWith("/media_proxy/") || p.startsWith("/media_attachments/") || p.startsWith("/system/")) {
    return true;
  }
  return mediaExts.has(extOf(p));
}

// acceptPrefersMedia reports whether Accept asks for image/video/audio ahead
// of every other representation this Worker serves. It is consulted only for
// paths that are not already claimed by a path-based branch.
//
// A browser page navigation also lists image types in Accept (e.g.
// "text/html,...,image/avif,image/webp"), so an equally or more preferred
// text/html range wins over media. More-preferred ActivityPub or JSON ranges
// also win.
function acceptPrefersMedia(request) {
  const accept = request.headers.get("Accept");
  const mediaRange = bestAcceptedMediaRange(accept);
  if (mediaRange === null) return false;

  const htmlQuality = qualityForAny(accept, "text/html");
  const activityPubQuality = qualityForAny(accept, "application/activity+json", "application/ld+json");
  const jsonQuality = qualityForAny(accept, "application/json", "application/jrd+json");
  return (
    mediaRange.quality > htmlQuality &&
    mediaRange.quality >= activityPubQuality &&
    mediaRange.quality >= jsonQuality
  );
}

// mediaContentType returns the Content-Type to echo back for a media
// request: the extension's known type if the path has one, otherwise the
// specific image/video/audio token from Accept (for extensionless paths like
// bare /media_proxy/… hits or hotlinked <img> tags with a browser Accept).
// Neither resolves for an extensionless media path whose Accept carries only a
// wildcard or no media range at all, so fall back to the generic binary type
// rather than emitting a typeless response that the request log cannot tell
// apart from a bug.
function mediaContentType(request, p) {
  const byExt = mediaExts.get(extOf(p));
  if (byExt) return byExt;
  const range = bestAcceptedMediaRange(request.headers.get("Accept"), true);
  return range ? range.type : "application/octet-stream";
}

// renderPage fills the fixed display domain into the cached template. The
// replacement is a function so "$" sequences would be inserted literally
// instead of being interpreted as replaceAll substitution patterns like $&.
function renderPage(domain) {
  const escaped = escapeHTML(domain);
  return pageTpl.replaceAll("__DOMAIN__", () => escaped);
}

const retirementPage = renderPage(displayDomain);

// jsonGoneBody is the small JSON error shared by the Mastodon REST API and
// JSON discovery paths. Mastodon's own web client (and third-party apps)
// parse the "error" field to show an alert.
const jsonGoneBody = '{"error":"Gone"}\n';

// xrdGoneBody is the XRD/XML equivalent of jsonGoneBody, for host-meta.
const xrdGoneBody =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0"><Error>Gone</Error></XRD>\n';

// writeGone builds a 410 response with the given Content-Type and body. An
// empty contentType or body is skipped, leaving no body written.
function writeGone(contentType, body) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  return new Response(body || null, { status: 410, headers });
}

// clientIP returns the originating client address. CF-Connecting-IP is set by
// Cloudflare's edge and can't be spoofed by the client, so it's preferred over
// X-Forwarded-For (which mirrors the App Platform proxy header the original
// Go server trusted).
function clientIP(request) {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const i = xff.indexOf(",");
    return (i >= 0 ? xff.slice(0, i) : xff).trim();
  }
  return "-";
}

// logRequest logs one structured JSON object per request so fields remain
// searchable and attacker-controlled values cannot forge the surrounding log
// structure. Health checks are skipped to avoid drowning the log. Set the
// LOG_REQUESTS var to "false" to disable.
function logRequest(request, response, path, env) {
  if (env.LOG_REQUESTS === "false") return;
  if (path === "/healthz") return;
  console.log(
    JSON.stringify({
      message: "request",
      status: response.status,
      method: request.method,
      path: `${path}${new URL(request.url).search}`,
      contentType: response.headers.get("Content-Type") || "-",
      host: rawHost(request),
      clientIP: clientIP(request),
      userAgent: request.headers.get("User-Agent") || "",
    })
  );
}

// handleGone answers every non-health request with HTTP 410 Gone (except
// /robots.txt). The response is chosen from the request path and headers so
// federating servers and API clients get compact machine-readable bodies
// while human browsers get the HTML page.
//
// Every path-based branch is checked before any Accept-based one. A path that
// names its own representation knows better than a header the client may have
// copied from a browser: without this ordering an `Accept: image/png` on
// /.well-known/webfinger would win over the WebFinger path itself.
function handleGone(request) {
  const path = new URL(request.url).pathname;
  const preferredMachine = preferredMachineRepresentation(request.headers.get("Accept"));

  // The resource is permanently gone, so let the client hold on to the 410
  // and stop re-requesting. Workers Cache now honors Vary, which makes the
  // representations safe to share at Cloudflare's edge. The HTML uses the
  // fixed displayDomain above, so it is also safe even though Workers Cache
  // deliberately omits the request host from its base key.
  // Cloudflare-CDN-Cache-Control is edge-only and takes precedence over the
  // client-facing private directive.
  // Applies to every 410 branch below. robots.txt is a separately cacheable
  // crawler directive, so it must not inherit these representation-specific
  // headers.
  const commonHeaders = { "Cache-Control": "private, max-age=86400", Vary: "Accept" };

  let response;
  if (path === "/robots.txt") {
    // Actively steer crawlers away. Unlike everything else this is a live
    // 200 directive, not a 410.
    response = new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } else if (isMediaPath(path)) {
    // Former bucket media (an <img>/<video> tag or a server refetch, which
    // ignores any body) gets an empty 410 rather than the ~9 KB page, echoing
    // back the requested media type as Content-Type.
    response = writeGone(mediaContentType(request, path), "");
  } else if (isHostMetaPath(path)) {
    // host-meta discovery, fetched programmatically. Real Mastodon's own
    // host-meta 410 is a bare `head 410`, but a small XRD error body costs
    // little and mirrors the JSON error given to the other discovery paths.
    response = writeGone("application/xrd+xml; charset=utf-8", xrdGoneBody);
  } else if (isInboxPath(path) || hasActivityPubContentType(request)) {
    // Inbox delivery POSTs, by path since they may lack Accept, and any other
    // request whose body is itself ActivityPub. Same JSON error body as the
    // branch below, but kept as application/activity+json since that's the
    // representation these clients actually work in.
    response = writeGone("application/activity+json; charset=utf-8", jsonGoneBody);
  } else if (isAPIPath(path) || isJSONPath(path)) {
    // Mastodon REST API, WebFinger / NodeInfo / OAuth discovery, and .json
    // resources, all by path and regardless of Accept, since these clients
    // (apps, scrapers, OAuth libraries) often send a browser-style Accept or
    // none at all.
    response = writeGone("application/json; charset=utf-8", jsonGoneBody);
  } else if (isFeedPath(path)) {
    // Dead RSS feed: return the matching content type so readers recognise
    // the 410 and stop polling. The body is empty.
    response = writeGone("application/rss+xml; charset=utf-8", "");
  } else if (acceptPrefersMedia(request)) {
    // No path signal, but Accept asks for media ahead of everything else —
    // a hotlinked subresource on a path this Worker does not recognise.
    response = writeGone(mediaContentType(request, path), "");
  } else if (preferredMachine === "activitypub") {
    // Actor/status fetches on unrecognised paths, chosen by Accept.
    response = writeGone("application/activity+json; charset=utf-8", jsonGoneBody);
  } else if (preferredMachine === "json") {
    // Generic JSON clients get the same small JSON error body.
    response = writeGone("application/json; charset=utf-8", jsonGoneBody);
  } else {
    response = new Response(retirementPage, {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (response.status === 410) {
    for (const [k, v] of Object.entries(commonHeaders)) response.headers.set(k, v);
    response.headers.set("Cloudflare-CDN-Cache-Control", "public, max-age=2592000");
  }

  // The retirement page is the only representation with a document body, so it
  // gets indexing and document controls on top of the universal headers that
  // fetch() applies.
  if (response.headers.get("Content-Type")?.startsWith("text/html")) {
    response.headers.set("X-Robots-Tag", "noindex, noarchive, nosnippet");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
  }
  return response;
}

// handleHealthz responds 200 for platform health checks. Kept separate so
// that real traffic (all 410) never makes the health check fail.
function handleHealthz() {
  return new Response("ok\n", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

// applySafeHeaders sets the headers that are correct for every representation.
// Applied here rather than in handleGone so that /healthz, which is served
// outside it, is covered too.
function applySafeHeaders(response) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  // Mastodon sends Access-Control-Allow-Origin: * on every path family this
  // Worker answers (/.well-known/*, /nodeinfo/*, /@user, /users/*, /api/*, and
  // the OAuth endpoints), so omitting it would regress against the server being
  // retired. Third-party web clients are cross-origin: without this the browser
  // rejects the response before the app can read it, turning a deliberate 410
  // and its JSON "error" field into an opaque network failure.
  //
  // Every response here is a fixed public document with no credentials
  // attached, so a constant "*" is safe. Being constant, it also does not
  // depend on Origin, which keeps Vary a single header and the cached variant
  // count unchanged.
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

// isPreflight reports whether a request is a CORS preflight rather than a plain
// OPTIONS request. Both marker headers are set by the browser and cannot be
// forged by page script, so an ordinary OPTIONS still falls through to the 410.
function isPreflight(request) {
  return (
    request.method === "OPTIONS" &&
    request.headers.has("Origin") &&
    request.headers.has("Access-Control-Request-Method")
  );
}

// handlePreflight answers a CORS preflight. It has to succeed with a 2xx even
// though every resource is gone: a preflight asks permission to send a request,
// it does not request the resource. Answering 410 fails the check, so the
// browser never sends the real request and the client never receives the 410 it
// is being told about.
//
// Requested headers are echoed back, matching Mastodon's own `headers: :any`
// CORS rule. The wildcard form of Access-Control-Allow-Headers deliberately
// does not cover Authorization, which every Mastodon API client sends, so a
// literal "*" here would fail exactly the clients that matter most.
function handlePreflight(request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // The browser's preflight cache is governed by Access-Control-Max-Age. This
    // only stops a shared cache from storing a response whose allowed headers
    // were negotiated for one specific request.
    "Cache-Control": "no-store",
  });
  const requested = request.headers.get("Access-Control-Request-Headers");
  if (requested) headers.set("Access-Control-Allow-Headers", requested);
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    let handled;
    if (isPreflight(request)) {
      handled = handlePreflight(request);
    } else if (path === "/healthz") {
      handled = handleHealthz();
    } else {
      handled = handleGone(request);
    }
    const response = applySafeHeaders(handled);
    logRequest(request, response, path, env);
    return response;
  },
};
