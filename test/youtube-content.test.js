const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read scripts
const utilsCode = fs.readFileSync("src/utils/extension.js", "utf8");
const contentCode = fs.readFileSync("src/youtube-content.js", "utf8");

// Mock the environment
const sandbox = {
  window: {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { href: "https://www.youtube.com/" },
    getComputedStyle: () => ({ color: "rgb(255, 255, 255)" }),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  },
  document: {
    createElement: () => ({ style: {}, classList: { add: () => {} }, remove: () => {} }),
    documentElement: { append: () => {}, appendChild: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    head: { appendChild: () => {} },
    body: { classList: { contains: () => false } }
  },
  chrome: {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({})
    }
  },
  MutationObserver: class {
    constructor() {}
    observe() {}
    disconnect() {}
  },
  Node: {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3
  },
  URL: URL,
  URLSearchParams: URLSearchParams,
  console: { error: () => {}, log: () => {}, warn: () => {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Number: Number,
  String: String,
  Array: Array,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Promise: Promise,
  Object: Object,
  Boolean: Boolean,
  RegExp: RegExp
};

vm.createContext(sandbox);
vm.runInContext(utilsCode, sandbox);
vm.runInContext(contentCode, sandbox);

describe("parseRgbColor", () => {
  it("should parse standard rgb format", () => {
    const result = sandbox.parseRgbColor("rgb(255, 0, 0)");
    assert.deepEqual(result, { r: 255, g: 0, b: 0 });

    const result2 = sandbox.parseRgbColor("rgb(15, 15, 15)");
    assert.deepEqual(result2, { r: 15, g: 15, b: 15 });
  });

  it("should parse standard rgba format", () => {
    const result = sandbox.parseRgbColor("rgba(0, 255, 0, 0.5)");
    assert.deepEqual(result, { r: 0, g: 255, b: 0 });

    const result2 = sandbox.parseRgbColor("rgba(241, 241, 241, 1)");
    assert.deepEqual(result2, { r: 241, g: 241, b: 241 });
  });

  it("should parse formats with varying spaces", () => {
    const result = sandbox.parseRgbColor("rgb(10,20,30)");
    assert.deepEqual(result, { r: 10, g: 20, b: 30 });

    const result2 = sandbox.parseRgbColor("rgba(10,   20,  30 , 0.5)");
    assert.deepEqual(result2, { r: 10, g: 20, b: 30 });
  });

  it("should return null for hex colors", () => {
    assert.strictEqual(sandbox.parseRgbColor("#ffffff"), null);
    assert.strictEqual(sandbox.parseRgbColor("#000"), null);
  });

  it("should return null for invalid string inputs", () => {
    assert.strictEqual(sandbox.parseRgbColor("foo"), null);
    assert.strictEqual(sandbox.parseRgbColor("red"), null);
    assert.strictEqual(sandbox.parseRgbColor("hsl(0, 100%, 50%)"), null);
  });

  it("should return null for invalid types", () => {
    assert.strictEqual(sandbox.parseRgbColor(null), null);
    assert.strictEqual(sandbox.parseRgbColor(undefined), null);
    assert.strictEqual(sandbox.parseRgbColor({}), null);
    assert.strictEqual(sandbox.parseRgbColor(123), null);
  });
});

describe("isChannelVideosPage", () => {
  it("should match @ChannelName/videos paths", () => {
    sandbox.window.location.pathname = "/@MKBHD/videos";
    assert.strictEqual(sandbox.isChannelVideosPage(), true);
  });

  it("should match /c/ChannelName/videos paths", () => {
    sandbox.window.location.pathname = "/c/LinusTechTips/videos";
    assert.strictEqual(sandbox.isChannelVideosPage(), true);
  });

  it("should match /channel/ChannelId/videos paths", () => {
    sandbox.window.location.pathname = "/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw/videos";
    assert.strictEqual(sandbox.isChannelVideosPage(), true);
  });

  it("should match /user/UserName/videos paths", () => {
    sandbox.window.location.pathname = "/user/mkbhd/videos";
    assert.strictEqual(sandbox.isChannelVideosPage(), true);
  });

  it("should return false for non-matching paths", () => {
    sandbox.window.location.pathname = "/watch?v=dQw4w9WgXcQ";
    assert.strictEqual(sandbox.isChannelVideosPage(), false);

    sandbox.window.location.pathname = "/@MKBHD/about";
    assert.strictEqual(sandbox.isChannelVideosPage(), false);

    sandbox.window.location.pathname = "/c/LinusTechTips";
    assert.strictEqual(sandbox.isChannelVideosPage(), false);

    sandbox.window.location.pathname = "/";
    assert.strictEqual(sandbox.isChannelVideosPage(), false);

    sandbox.window.location.pathname = "";
    assert.strictEqual(sandbox.isChannelVideosPage(), false);
  });
});

describe("normalizeDateText", () => {
  it("should return empty string for empty, null, or undefined inputs", () => {
    assert.strictEqual(sandbox.normalizeDateText(""), "");
    assert.strictEqual(sandbox.normalizeDateText(null), "");
    assert.strictEqual(sandbox.normalizeDateText(undefined), "");
  });

  it("should coerce non-string inputs to string", () => {
    assert.strictEqual(sandbox.normalizeDateText(123), "123");
    assert.strictEqual(sandbox.normalizeDateText(true), "true");
  });

  it("should lowercase all text", () => {
    assert.strictEqual(sandbox.normalizeDateText("OCTOBER 15"), "october 15");
    assert.strictEqual(sandbox.normalizeDateText("JanUary"), "january");
  });

  it("should replace whitespace, tabs, newlines, commas, and bullets with spaces and deduplicate them", () => {
    assert.strictEqual(sandbox.normalizeDateText("  May  12  "), "may 12");
    assert.strictEqual(sandbox.normalizeDateText("May\t12\n2022"), "may 12 2022");
    assert.strictEqual(sandbox.normalizeDateText("May 12, 2022 \u2022"), "may 12 2022");
    assert.strictEqual(sandbox.normalizeDateText("\u00a0Jan\u00a01\u00a0"), "jan 1");
  });

  it("should replace specific Turkish characters with standard English letters", () => {
    assert.strictEqual(sandbox.normalizeDateText("\u015f\u0131\u011f\u00fc\u00f6\u00e7"), "siguoc");
    assert.strictEqual(sandbox.normalizeDateText("MAYI\u015e"), "mayis");
  });
});
