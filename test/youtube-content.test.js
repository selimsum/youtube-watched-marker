const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const extensionCode = fs.readFileSync("src/utils/extension.js", "utf8");
const ytCode = fs.readFileSync("src/youtube-content.js", "utf8");

const documentElement = {
  nodeType: 1,
  matches: () => false,
  querySelectorAll: () => [],
  addEventListener: () => {}
};

const sandbox = {
  window: { location: { origin: "https://www.youtube.com" } },
  document: {
    documentElement,
    createElement: () => ({ style: {} }),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    querySelector: () => null
  },
  chrome: {
    runtime: {
      sendMessage: () => Promise.resolve({}),
      onMessage: { addListener: () => {} }
    }
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  Node: { ELEMENT_NODE: 1 },
  console: { error: () => {}, log: () => {} },
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
  URL: URL
};

vm.createContext(sandbox);
vm.runInContext(extensionCode, sandbox);
vm.runInContext("function getExtensionApi() { return chrome; }", sandbox);
vm.runInContext(ytCode, sandbox);

describe("getRelativeUnitDays", () => {
  it("should return 0.5 for second/minute/hour units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("second"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("seconds"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("minute"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("minutes"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("hour"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("hours"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("saniye"), 0.5);
    assert.strictEqual(sandbox.getRelativeUnitDays("saat"), 0.5);
  });

  it("should return 1 for day units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("day"), 1);
    assert.strictEqual(sandbox.getRelativeUnitDays("days"), 1);
    assert.strictEqual(sandbox.getRelativeUnitDays("gun"), 1);
  });

  it("should return 7 for week units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("week"), 7);
    assert.strictEqual(sandbox.getRelativeUnitDays("weeks"), 7);
    assert.strictEqual(sandbox.getRelativeUnitDays("hafta"), 7);
  });

  it("should return 30 for month units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("month"), 30);
    assert.strictEqual(sandbox.getRelativeUnitDays("months"), 30);
    assert.strictEqual(sandbox.getRelativeUnitDays("ay"), 30);
  });

  it("should return 365 for year units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("year"), 365);
    assert.strictEqual(sandbox.getRelativeUnitDays("years"), 365);
    assert.strictEqual(sandbox.getRelativeUnitDays("yil"), 365);
  });

  it("should return null for unknown units", () => {
    assert.strictEqual(sandbox.getRelativeUnitDays("unknown"), null);
    assert.strictEqual(sandbox.getRelativeUnitDays(""), null);
    assert.strictEqual(sandbox.getRelativeUnitDays(undefined), null);
    assert.strictEqual(sandbox.getRelativeUnitDays(null), null);
  });
});
