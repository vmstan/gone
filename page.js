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

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function escapeHTML(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;");
}

export function createRetirementPage(logoSvg, domain) {
  return PAGE_TEMPLATE
    .replace("__LOGO_DATA__", () => toBase64(logoSvg))
    .replaceAll("__DOMAIN__", () => escapeHTML(domain));
}
