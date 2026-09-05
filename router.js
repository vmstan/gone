const GONE_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=86400",
  "Cloudflare-CDN-Cache-Control": "public, max-age=2592000",
  Vary: "Accept",
};

const MACHINE_PATHS = new Set([
  "/.well-known/host-meta",
  "/.well-known/nodeinfo",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/.well-known/webfinger",
  "/.well-known/x-nodeinfo2",
  "/oauth/revoke",
  "/oauth/token",
  "/oauth/userinfo",
]);

const MACHINE_ACCEPT_TYPES = [
  "application/activity+json",
  "application/jrd+json",
  "application/json",
  "application/ld+json",
];

const MEDIA_PATH = /\.(?:avif|bmp|flac|gif|heic|ico|jpe?g|m4a|m4v|mov|mp3|mp4|oga|ogg|ogv|png|svg|tiff?|wav|webm|webp)$/i;
const MEDIA_TYPE = /^(?:audio|image|video)\//;

function acceptRanges(headerValue) {
  return (headerValue || "").split(",").map((value) => {
    const [type, ...parameters] = value.trim().split(";");
    const qParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
    const parsedQuality = qParameter ? Number(qParameter.split("=", 2)[1].trim()) : 1;
    const quality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1 ? parsedQuality : 0;
    return { type: type.toLowerCase(), quality };
  });
}

function qualityFor(ranges, predicate) {
  return ranges.reduce(
    (highest, range) => (predicate(range.type) ? Math.max(highest, range.quality) : highest),
    0
  );
}

function isPreflight(request) {
  return (
    request.method === "OPTIONS" &&
    request.headers.has("Origin") &&
    request.headers.has("Access-Control-Request-Method")
  );
}

function isMediaPath(path) {
  return (
    path.startsWith("/media_proxy/") ||
    path.startsWith("/media_attachments/") ||
    path.startsWith("/system/") ||
    MEDIA_PATH.test(path)
  );
}

function isMachinePath(path) {
  return (
    MACHINE_PATHS.has(path) ||
    path.startsWith("/api/") ||
    path.startsWith("/nodeinfo/") ||
    path.endsWith("/inbox") ||
    path.endsWith(".json") ||
    path.endsWith(".rss")
  );
}

function carriesMachineBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
  return MACHINE_ACCEPT_TYPES.some((type) => contentType.startsWith(type));
}

export function classifyRequest(request, path) {
  if (isMediaPath(path)) return "media";
  if (isMachinePath(path) || carriesMachineBody(request)) return "machine";

  const ranges = acceptRanges(request.headers.get("Accept"));
  const htmlQuality = qualityFor(ranges, (type) => type === "text/html");
  const machineQuality = qualityFor(ranges, (type) => MACHINE_ACCEPT_TYPES.includes(type));
  const mediaQuality = qualityFor(ranges, (type) => MEDIA_TYPE.test(type));

  if (htmlQuality > 0 && htmlQuality >= machineQuality && htmlQuality >= mediaQuality) return "html";
  if (machineQuality > 0 && machineQuality >= mediaQuality) return "machine";
  if (mediaQuality > 0) return "media";
  return "html";
}

export function applySafeHeaders(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function preflightResponse(request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  });
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  if (requestedHeaders) headers.set("Access-Control-Allow-Headers", requestedHeaders);
  return new Response(null, { status: 204, headers });
}

function goneResponse(kind, retirementPage) {
  if (kind === "media") {
    return new Response(null, { status: 410, headers: GONE_CACHE_HEADERS });
  }

  if (kind === "machine") {
    return new Response('{"error":"Gone"}\n', {
      status: 410,
      headers: { ...GONE_CACHE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(retirementPage, {
    status: 410,
    headers: {
      ...GONE_CACHE_HEADERS,
      "Content-Security-Policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, noarchive, nosnippet",
    },
  });
}

export function handleRequest(request, retirementPage) {
  const path = new URL(request.url).pathname;
  const isReadRequest = request.method === "GET" || request.method === "HEAD";

  let response;
  if (isPreflight(request)) {
    response = preflightResponse(request);
  } else if (isReadRequest && path === "/healthz") {
    response = new Response("ok\n", {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (isReadRequest && path === "/robots.txt") {
    response = new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Cache-Control": "public, max-age=86400", "Content-Type": "text/plain; charset=utf-8" },
    });
  } else {
    response = goneResponse(classifyRequest(request, path), retirementPage);
  }

  return applySafeHeaders(response);
}
