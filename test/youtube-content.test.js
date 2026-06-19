const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const extensionCode = fs.readFileSync("src/utils/extension.js", "utf8");
const youtubeContentCode = fs.readFileSync("src/youtube-content.js", "utf8");

// Mock the environment
const sandbox = {
  chrome: {
      runtime: {
          sendMessage: () => Promise.resolve({}),
          onMessage: { addListener: () => {} }
      }
  },
  window: {
      addEventListener: () => {},
      requestAnimationFrame: () => {},
      setTimeout: () => {},
      location: { pathname: '', search: '' },
      getComputedStyle: () => ({ color: '' })
  },
  document: {
    addEventListener: () => {},
    body: { dataset: {} },
    createElement: () => ({ style: {} }),
    head: { appendChild: () => {} },
    querySelectorAll: () => [],
    getElementById: () => null,
    documentElement: { nodeType: 1, matches: () => false, querySelectorAll: () => [], addEventListener: () => {} }
  },
  Node: { ELEMENT_NODE: 1 },
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Number, String, Array, Date, Math, JSON, Promise, Object, Boolean, RegExp, console,
  URLSearchParams: class URLSearchParams { constructor() {} get() {} },
  URL: class URL { constructor() {} },
};

vm.createContext(sandbox);

vm.runInContext(extensionCode + "\n" + youtubeContentCode, sandbox);

describe("getRelativeLuminance", () => {
  it("should calculate luminance for white correctly", () => {
    const code = `getRelativeLuminance("rgb(255, 255, 255)")`;
    const result = vm.runInContext(code, sandbox);
    assert.strictEqual(result, 1);
  });

  it("should calculate luminance for black correctly", () => {
    const code = `getRelativeLuminance("rgb(0, 0, 0)")`;
    const result = vm.runInContext(code, sandbox);
    assert.strictEqual(result, 0);
  });

  it("should calculate luminance for a mid-tone color correctly", () => {
    // RGB(128, 128, 128)
    const code = `getRelativeLuminance("rgb(128, 128, 128)")`;
    const result = vm.runInContext(code, sandbox);
    assert.ok(Math.abs(result - 0.2158605) < 0.001);
  });

  it("should calculate luminance for a dark color correctly", () => {
    const code = `getRelativeLuminance("rgb(10, 10, 10)")`;
    const result = vm.runInContext(code, sandbox);
    const expectedNorm = 10 / 255;
    const expectedChannel = expectedNorm / 12.92;
    const expectedLuminance = (0.2126 * expectedChannel) + (0.7152 * expectedChannel) + (0.0722 * expectedChannel);
    assert.ok(Math.abs(result - expectedLuminance) < 0.0001);
  });

  it("should return null for invalid color formats", () => {
    assert.strictEqual(vm.runInContext(`getRelativeLuminance("invalid")`, sandbox), null);
    assert.strictEqual(vm.runInContext(`getRelativeLuminance("")`, sandbox), null);
    assert.strictEqual(vm.runInContext(`getRelativeLuminance(null)`, sandbox), null);
    assert.strictEqual(vm.runInContext(`getRelativeLuminance(undefined)`, sandbox), null);
  });

  it("should handle rgba formats correctly", () => {
    const code = `getRelativeLuminance("rgba(255, 255, 255, 0.5)")`;
    const result = vm.runInContext(code, sandbox);
    assert.strictEqual(result, 1);
  });
});
