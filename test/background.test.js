const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read background.js
const backgroundCode = fs.readFileSync("src/utils/extension.js", "utf8") + "\n" + fs.readFileSync("src/background.js", "utf8");

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
  Boolean: Boolean
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
