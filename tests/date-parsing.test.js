"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadContentScript(options = {}) {
  const root = path.join(__dirname, "..");
  const files = [
    "src/utils/extension.js",
    "src/utils/youtube.js",
    "src/delay.js",
    "src/youtube-content.js"
  ];

  const context = {
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    WeakMap,
    WeakSet,
    RegExp,
    JSON,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    Node: { ELEMENT_NODE: 1 },
    Element: function Element() {},
    navigator: { language: options.navigatorLanguage || "en-GB" },
    window: null,
    document: {
      title: "YouTube",
      documentElement: {
        lang: options.docLang || "en-GB",
        scrollHeight: 1000
      },
      scripts: [],
      body: { dispatchEvent: () => {} },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      dispatchEvent: () => {}
    },
    browser: {
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        sendMessage: async () => ({}),
        onMessage: { addListener: () => {} }
      }
    }
  };
  context.window = {
    location: new URL("https://www.youtube.com/@test/videos"),
    addEventListener: () => {},
    dispatchEvent: () => {},
    scrollTo: () => {}
  };

  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return context;
}

test("relative publish dates compute accurate offsets for seconds, minutes, hours, and Turkish dakika", () => {
  const ctx = loadContentScript();
  const DAY_MS = 24 * 60 * 60 * 1000;

  assert.ok(Math.abs(ctx.getRelativeUnitDays("second") - 1 / 86400) < 1e-9);
  assert.ok(Math.abs(ctx.getRelativeUnitDays("minutes") - 1 / 1440) < 1e-9);
  assert.ok(Math.abs(ctx.getRelativeUnitDays("dakika") - 1 / 1440) < 1e-9);
  assert.ok(Math.abs(ctx.getRelativeUnitDays("hours") - 1 / 24) < 1e-9);
  assert.ok(Math.abs(ctx.getRelativeUnitDays("saat") - 1 / 24) < 1e-9);

  const now = Date.now();
  const twoHoursAgo = ctx.parsePublishDateText("2 hours ago");
  assert.ok(twoHoursAgo);
  assert.equal(twoHoursAgo.precision, "approximate");
  assert.ok(Math.abs(now - twoHoursAgo.publishedMs - 2 * 60 * 60 * 1000) < 5000);

  const tenMinutesTr = ctx.parsePublishDateText("10 dakika önce");
  assert.ok(tenMinutesTr);
  assert.ok(Math.abs(now - tenMinutesTr.publishedMs - 10 * 60 * 1000) < 5000);

  const threeDaysAgo = ctx.parsePublishDateText("3 days ago");
  assert.ok(threeDaysAgo);
  assert.ok(Math.abs(now - threeDaysAgo.publishedMs - 3 * DAY_MS) < 5000);
});

test("exact publish dates handle ISO, dot, EN/TR months, and locale-aware slashes", () => {
  const gbCtx = loadContentScript({ docLang: "en-GB" });
  const iso = gbCtx.parsePublishDateText("2026-04-14");
  assert.equal(iso.precision, "exact");
  assert.equal(new Date(iso.publishedMs).getFullYear(), 2026);
  assert.equal(new Date(iso.publishedMs).getMonth(), 3);
  assert.equal(new Date(iso.publishedMs).getDate(), 14);

  const dot = gbCtx.parsePublishDateText("14.04.2026");
  assert.equal(new Date(dot.publishedMs).getMonth(), 3);
  assert.equal(new Date(dot.publishedMs).getDate(), 14);

  const trMonth = gbCtx.parsePublishDateText("14 Nisan 2026");
  assert.equal(new Date(trMonth.publishedMs).getMonth(), 3);
  assert.equal(new Date(trMonth.publishedMs).getDate(), 14);

  const enMonth = gbCtx.parsePublishDateText("Apr 14, 2026");
  assert.equal(new Date(enMonth.publishedMs).getMonth(), 3);
  assert.equal(new Date(enMonth.publishedMs).getDate(), 14);

  // Ambiguous slash date respects en-US MM/DD/YYYY vs en-GB DD/MM/YYYY
  const usCtx = loadContentScript({ docLang: "en-US" });
  const usAmbig = usCtx.parsePublishDateText("04/05/2026");
  assert.equal(new Date(usAmbig.publishedMs).getMonth(), 3); // April
  assert.equal(new Date(usAmbig.publishedMs).getDate(), 5);

  const gbAmbig = gbCtx.parsePublishDateText("04/05/2026");
  assert.equal(new Date(gbAmbig.publishedMs).getMonth(), 4); // May
  assert.equal(new Date(gbAmbig.publishedMs).getDate(), 4);

  // Unambiguous MM/DD/YYYY still works even in non-US locale
  const gbUnambig = gbCtx.parsePublishDateText("04/14/2026");
  assert.equal(new Date(gbUnambig.publishedMs).getMonth(), 3);
  assert.equal(new Date(gbUnambig.publishedMs).getDate(), 14);
});

test("looksLikePublishDateText uses word boundaries for month names", () => {
  const ctx = loadContentScript();
  assert.equal(ctx.looksLikePublishDateText("Mayhem in the arena"), false);
  assert.equal(ctx.looksLikePublishDateText("Augustus Caesar documentary"), false);
  assert.equal(ctx.looksLikePublishDateText("14 May 2026"), true);
  assert.equal(ctx.looksLikePublishDateText("5 days ago"), true);
});

test("getPublishTextCandidates ignores title elements and prioritizes metadata", () => {
  const ctx = loadContentScript();
  const titleEl = {
    textContent: "2020-01-01 Throwback",
    getAttribute: () => null,
    closest: (sel) => (sel.includes("a#video-title") ? titleEl : null)
  };
  const metaEl = {
    textContent: "2 days ago",
    getAttribute: () => null,
    closest: () => null
  };
  const container = {
    textContent: "2020-01-01 Throwback 2 days ago",
    querySelectorAll: (sel) => (sel.includes("#metadata-line") ? [metaEl] : [titleEl, metaEl])
  };

  const candidates = ctx.getPublishTextCandidates(container);
  assert.deepEqual(Array.from(candidates), ["2 days ago"]);
});
