const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read background.js
const backgroundCode = fs.readFileSync("src/utils/extension.js", "utf8") + "\n" + fs.readFileSync("src/utils/youtube.js", "utf8") + "\n" + fs.readFileSync("src/background.js", "utf8");

// Mock the environment
const sandbox = {
  chrome: {
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    contextMenus: {
      onClicked: { addListener: () => {} },
      create: () => {},
      remove: async () => {}
    },
    tabs: {
      onCreated: { addListener: () => {} },
      onUpdated: { addListener: () => {} }
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  },
  console: { error: () => {}, log: () => {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Number: Number,
  String: String,
  Array: Array,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Promise: Promise,
  Object: Object,
  Boolean: Boolean,
  URL: URL,
  URLSearchParams: URLSearchParams
};

vm.createContext(sandbox);
vm.runInContext(backgroundCode, sandbox);

describe("normalizeSettingNumber", () => {
  it("should return the number when it's within bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(5, 10, 1, 20), 5);
    assert.strictEqual(sandbox.normalizeSettingNumber(15, 10, 1, 20), 15);
  });

  it("should return the minimum when the number is below bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(0, 10, 1, 20), 1);
    assert.strictEqual(sandbox.normalizeSettingNumber(-5, 10, 1, 20), 1);
  });

  it("should return the maximum when the number is above bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(25, 10, 1, 20), 20);
    assert.strictEqual(sandbox.normalizeSettingNumber(100, 10, 1, 20), 20);
  });

  it("should round decimal numbers before bounding", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(5.4, 10, 1, 20), 5);
    assert.strictEqual(sandbox.normalizeSettingNumber(5.5, 10, 1, 20), 6);
    assert.strictEqual(sandbox.normalizeSettingNumber(0.4, 10, 1, 20), 1); // 0 rounded is 0, bounded is 1
  });

  it("should parse string numbers", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber("12", 10, 1, 20), 12);
    assert.strictEqual(sandbox.normalizeSettingNumber("5.6", 10, 1, 20), 6);
  });

  it("should return the fallback for invalid numbers", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(NaN, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(undefined, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber("abc", 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(Infinity, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(-Infinity, 10, 1, 20), 10);
  });
});

describe("extractVideoIdFromUrl", () => {
  it("should extract video ID from standard /watch?v= URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("http://youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from shortened youtu.be/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("http://youtu.be/dQw4w9WgXcQ?t=123"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /shorts/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /embed/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /live/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should return null for invalid or non-YouTube URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("not-a-url"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl(null), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl(""), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/playlist?list=PLxyz"), null);
  });

  it("should return null for malformed video IDs", () => {
    // Too short
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXc"), null);
    // Too long
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ1"), null);
    // Invalid characters
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9W!XcQ"), null);
  });
});

describe("getActiveQueueCount", () => {
  it("should return 0 for an empty queue", () => {
    assert.strictEqual(sandbox.getActiveQueueCount([]), 0);
  });

  it("should count only 'pending' items", () => {
    const queue = [
      { status: "pending" },
      { status: "completed" },
      { status: "error" },
      { status: "pending" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 2);
  });

  it("should count only 'running' items", () => {
    const queue = [
      { status: "running" },
      { status: "completed" },
      { status: "running" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 2);
  });

  it("should count both 'pending' and 'running' items", () => {
    const queue = [
      { status: "pending" },
      { status: "running" },
      { status: "completed" },
      { status: "error" },
      { status: "running" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 3);
  });

  it("should return 0 when there are no active items", () => {
    const queue = [
      { status: "completed" },
      { status: "error" },
      { status: "cancelled" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 0);
  });
});

describe("normalizeUrl", () => {
  it("should return a URL object for a valid URL string", () => {
    const url = sandbox.normalizeUrl("https://example.com/path?query=1");
    assert.ok(url instanceof URL);
    assert.strictEqual(url.href, "https://example.com/path?query=1");
  });

  it("should return null for an invalid URL string", () => {
    assert.strictEqual(sandbox.normalizeUrl("not-a-url"), null);
    assert.strictEqual(sandbox.normalizeUrl("http://"), null);
  });

  it("should return null for non-string inputs", () => {
    assert.strictEqual(sandbox.normalizeUrl(null), null);
    assert.strictEqual(sandbox.normalizeUrl(undefined), null);
    assert.strictEqual(sandbox.normalizeUrl(123), null);
    assert.strictEqual(sandbox.normalizeUrl({}), null);
    assert.strictEqual(sandbox.normalizeUrl([]), null);
    assert.strictEqual(sandbox.normalizeUrl(true), null);
  });

  it("should return null for empty string", () => {
    assert.strictEqual(sandbox.normalizeUrl(""), null);
  });
});
