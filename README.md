# Gone

A small Cloudflare Worker for retiring a Mastodon/ActivityPub server and its
media bucket. Retired resources return `HTTP 410 Gone`; browser visits receive a
self-contained retirement page for `vmst.io`.

The page includes the Mastodon logo, dark mode, reduced-motion support, and the
canvas disintegration effect. It has no external runtime dependencies.

## Responses

Routing is path-first and uses four response classes:

| Request | Response |
| --- | --- |
| Browser page | `410` with the HTML retirement page |
| API, discovery, ActivityPub, or feed | `410` with `{"error":"Gone"}` as JSON |
| Media path or media-only `Accept` header | Empty `410` |
| CORS preflight | `204` with CORS permissions |

Known API and protocol paths take precedence over `Accept`. For otherwise
unknown paths, quality weights choose between HTML, machine, and media
responses; HTML wins ties, and ranges with `q=0` are rejected.

`/robots.txt` returns a live `200` disallow-all directive. `/healthz` returns a
live, uncached `200` health response.

All responses include CORS and basic safety headers. The HTML response also
includes a restrictive Content Security Policy and crawler directives.

Gone responses are cached privately by clients for one day and at Cloudflare's
edge for 30 days. `Vary: Accept` keeps the three representations separate.
Workers Observability records invocation logs and traces.

## Run locally

```sh
pnpm install
pnpm dev
```

Then visit <http://localhost:8787>.

## Test

```sh
pnpm test
```

The tests use Node's built-in test runner and Web APIs; they do not start a
separate Worker runtime.

## Deploy

Each hostname's zone must already be active in the Cloudflare account. Add a
`routes` entry in `wrangler.json` for any additional hostname, then run:

```sh
pnpm deploy
```
