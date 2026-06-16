const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read utils/extension.js and background.js
const utilsCode = fs.readFileSync("src/utils/extension.js", "utf8");
const backgroundCode = fs.readFileSync("src/background.js", "utf8");

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
vm.runInContext(utilsCode, sandbox);
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

describe("buildWatchUrl", () => {
  it("should return the correct watch url with required parameters", () => {
    const expectedUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1&mute=1&autoplay=0";
    assert.strictEqual(sandbox.buildWatchUrl("dQw4w9WgXcQ"), expectedUrl);
  });
});
