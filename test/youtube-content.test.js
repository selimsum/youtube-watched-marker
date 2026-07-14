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

describe("buildWorkerUrl", () => {
  it("should return a correctly formatted URL with video ID and ytwm_worker query param for watch URLs", () => {
    const url = sandbox.buildWorkerUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.strictEqual(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1");
  });

  it("should return a correctly formatted URL for shorts URLs", () => {
    const url = sandbox.buildWorkerUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    assert.strictEqual(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1");
  });

  it("should return a correctly formatted URL for embed URLs", () => {
    const url = sandbox.buildWorkerUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
    assert.strictEqual(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1");
  });

  it("should return null if the URL is invalid", () => {
    assert.strictEqual(sandbox.buildWorkerUrl("invalid-url"), null);
  });

  it("should return null if the URL does not contain a video ID", () => {
    assert.strictEqual(sandbox.buildWorkerUrl("https://www.youtube.com/feed/subscriptions"), null);
  });

  it("should return null if the input is null or undefined", () => {
    assert.strictEqual(sandbox.buildWorkerUrl(null), null);
    assert.strictEqual(sandbox.buildWorkerUrl(undefined), null);
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
