import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { createRetirementPage } from "../page.js";

function createCanvas(displayWidth) {
  const listeners = new Map();
  let layoutReads = 0;
  const calls = {
    clearRect: [],
    drawImage: [],
    restore: [],
    rotate: [],
    save: [],
    translate: [],
  };
  const context = {};
  for (const operation of Object.keys(calls)) {
    context[operation] = (...args) => calls[operation].push(args);
  }

  return {
    calls,
    canvas: {
      width: 300,
      height: 150,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      getBoundingClientRect() {
        layoutReads += 1;
        return { width: displayWidth, left: 12, top: 24 };
      },
      getContext(type) {
        assert.equal(type, "2d");
        return context;
      },
    },
    listeners,
    layoutReads: () => layoutReads,
  };
}

function createBrowserHarness({ reducedMotion = false, supportsMatchMedia = true } = {}) {
  const main = createCanvas(140);
  const overlay = createCanvas(800);
  const frames = [];
  const windowListeners = new Map();
  const images = [];
  let randomCalls = 0;

  class FakeImage {
    constructor() {
      this.naturalWidth = 75;
      this.naturalHeight = 79;
      images.push(this);
    }

    set src(value) {
      this.currentSrc = value;
    }
  }

  const browserWindow = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  if (supportsMatchMedia) {
    browserWindow.matchMedia = (query) => {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reducedMotion };
    };
  }
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => {
    randomCalls += 1;
    return 0.25;
  };

  const page = createRetirementPage("<svg></svg>", "vmst.io");
  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "retirement page should contain an executable script");
  vm.runInNewContext(script, {
    document: {
      getElementById(id) {
        if (id === "illustration") return main.canvas;
        if (id === "illustration-overlay") return overlay.canvas;
        assert.fail(`unexpected element id: ${id}`);
      },
    },
    Image: FakeImage,
    Math: deterministicMath,
    requestAnimationFrame(callback) {
      frames.push(callback);
    },
    window: browserWindow,
  });

  assert.equal(images.length, 1);
  return {
    frames,
    image: images[0],
    main,
    overlay,
    randomCalls: () => randomCalls,
    triggerCanvas(type) {
      assert.ok(main.listeners.has(type), `${type} listener should be registered`);
      main.listeners.get(type)();
    },
    triggerWindow(type) {
      assert.ok(windowListeners.has(type), `${type} listener should be registered`);
      windowListeners.get(type)();
    },
  };
}

test("the browser script loads, sizes, animates, and resizes the canvases", () => {
  const harness = createBrowserHarness();

  assert.match(harness.image.currentSrc, /^data:image\/svg\+xml;base64,/);

  // Exercise a resize before image loading, then verify onload rebuilds the
  // tile grid for the SVG's real dimensions rather than the placeholder size.
  harness.triggerWindow("resize");
  const randomCallsBeforeLoad = harness.randomCalls();
  assert.ok(randomCallsBeforeLoad > 0);

  const drawsBeforeLoad = harness.main.calls.drawImage.length;
  harness.image.onload();
  assert.equal(harness.main.canvas.width, 450);
  assert.equal(harness.main.canvas.height, 474);
  assert.equal(harness.overlay.canvas.width, 800);
  assert.equal(harness.overlay.canvas.height, 600);
  assert.ok(harness.randomCalls() > randomCallsBeforeLoad);
  assert.equal(harness.main.calls.drawImage.length - drawsBeforeLoad, 1);
  assert.deepEqual(harness.main.calls.drawImage.at(-1), [harness.image, 0, 0, 75, 79, 0, 0, 450, 474]);

  const randomCallsAfterLoad = harness.randomCalls();
  const drawsAfterLoad = harness.main.calls.drawImage.length;
  harness.triggerWindow("resize");
  assert.equal(harness.randomCalls(), randomCallsAfterLoad);
  assert.equal(harness.main.calls.drawImage.length - drawsAfterLoad, 1);

  harness.triggerCanvas("click");
  assert.equal(harness.frames.length, 1);
  harness.triggerCanvas("mouseenter");
  assert.equal(harness.frames.length, 1);
  harness.frames.shift()(0);
  harness.frames.shift()(1000);
  assert.ok(harness.overlay.calls.translate.length > 0);
  assert.ok(harness.overlay.calls.rotate.length > 0);

  const randomCallsDuringAnimation = harness.randomCalls();
  harness.triggerWindow("resize");
  assert.equal(harness.randomCalls(), randomCallsDuringAnimation);

  let timestamp = 2000;
  while (harness.frames.length) {
    harness.frames.shift()(timestamp);
    timestamp += 1000;
    assert.ok(timestamp < 10000, "animation should reach its target");
  }

  assert.ok(harness.main.calls.save.length > 0);
  assert.ok(harness.main.calls.restore.length > 0);
  assert.ok(harness.overlay.calls.clearRect.length > 0);

  const finalDraws = harness.main.calls.drawImage.length;
  const finalOverlayDraws = harness.overlay.calls.drawImage.length;
  const finalLayoutReads = harness.main.layoutReads();
  harness.triggerCanvas("click");
  harness.triggerCanvas("mouseenter");
  assert.equal(harness.frames.length, 0);
  assert.equal(harness.main.calls.drawImage.length, finalDraws);

  harness.triggerWindow("resize");
  assert.equal(harness.main.calls.drawImage.length - finalDraws, 1);
  assert.equal(harness.overlay.calls.drawImage.length, finalOverlayDraws);
  assert.equal(harness.main.layoutReads(), finalLayoutReads);
});

test("reduced motion prevents hover and click animations", () => {
  const harness = createBrowserHarness({ reducedMotion: true });
  harness.image.onload();

  harness.triggerCanvas("mouseenter");
  harness.triggerCanvas("click");

  assert.equal(harness.frames.length, 0);
  assert.equal(harness.overlay.calls.translate.length, 0);
  assert.equal(harness.main.calls.drawImage.length, 1);
});

test("browsers without matchMedia still run the animation", () => {
  const harness = createBrowserHarness({ supportsMatchMedia: false });
  harness.image.onload();
  harness.triggerCanvas("click");

  assert.equal(harness.frames.length, 1);
});
