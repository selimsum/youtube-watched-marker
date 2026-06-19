const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read dependencies
const utilsCode = fs.readFileSync("src/utils/extension.js", "utf8");
const ytCode = fs.readFileSync("src/youtube-content.js", "utf8");

// Mock the environment
const sandbox = {
  chrome: {
    runtime: {
      sendMessage: () => Promise.resolve({}),
      getURL: () => "",
      onMessage: { addListener: () => {} }
    }
  },
  window: {
    location: { pathname: "", href: "", origin: "" },
    getComputedStyle: () => ({ color: "" }),
    dispatchEvent: () => {}
  },
  document: {
    documentElement: {
      scrollHeight: 0,
      hasAttribute: () => false,
      append: () => {},
      dispatchEvent: () => {}
    },
    scripts: [],
    title: "",
    createElement: () => ({ remove: () => {} }),
    querySelector: () => null,
    addEventListener: () => {}
  },
  MutationObserver: class { observe() {} },
  URL: class { constructor() { return { toString: () => "" } } },
  Node: { ELEMENT_NODE: 1 }
};

vm.createContext(sandbox);
vm.runInContext(utilsCode, sandbox);
vm.runInContext(ytCode, sandbox);

// Extract function for testing
const parseRgbColor = (value) => {
  const result = vm.runInContext(`parseRgbColor(${JSON.stringify(value)})`, sandbox);
  if (!result) return null;
  // Convert from sandbox object to Node object for deep equality
  return { r: result.r, g: result.g, b: result.b };
};

describe("youtube-content.js", () => {
  describe("parseRgbColor", () => {
    it("parses valid rgb strings", () => {
      assert.deepStrictEqual(parseRgbColor("rgb(255, 0, 0)"), { r: 255, g: 0, b: 0 });
      assert.deepStrictEqual(parseRgbColor("rgb(0, 255, 0)"), { r: 0, g: 255, b: 0 });
      assert.deepStrictEqual(parseRgbColor("rgb(0, 0, 255)"), { r: 0, g: 0, b: 255 });
      assert.deepStrictEqual(parseRgbColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255 });
      assert.deepStrictEqual(parseRgbColor("rgb(0, 0, 0)"), { r: 0, g: 0, b: 0 });
    });

    it("parses valid rgba strings", () => {
      assert.deepStrictEqual(parseRgbColor("rgba(255, 0, 0, 0.5)"), { r: 255, g: 0, b: 0 });
      assert.deepStrictEqual(parseRgbColor("rgba(0, 0, 0, 1)"), { r: 0, g: 0, b: 0 });
    });

    it("ignores internal whitespace appropriately according to current regex", () => {
      // The current regex is /rgba?\((\d+),\s*(\d+),\s*(\d+)/i
      // So it requires no space after '(', but allows space after commas.
      assert.deepStrictEqual(parseRgbColor("rgb(255, 0, 0)"), { r: 255, g: 0, b: 0 });
      assert.deepStrictEqual(parseRgbColor("rgba(0,0,0,0.5)"), { r: 0, g: 0, b: 0 });
      assert.strictEqual(parseRgbColor("rgb( 255, 0, 0)"), null);
    });

    it("is case-insensitive for rgb/rgba", () => {
      assert.deepStrictEqual(parseRgbColor("RGB(255, 0, 0)"), { r: 255, g: 0, b: 0 });
      assert.deepStrictEqual(parseRgbColor("rGbA(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0 });
    });

    it("returns null for hex strings", () => {
      assert.strictEqual(parseRgbColor("#ff0000"), null);
      assert.strictEqual(parseRgbColor("#fff"), null);
    });

    it("returns null for invalid color strings", () => {
      assert.strictEqual(parseRgbColor("red"), null);
      assert.strictEqual(parseRgbColor("not-a-color"), null);
      assert.strictEqual(parseRgbColor("rgb(255)"), null);
    });

    it("returns null for non-string inputs", () => {
      assert.strictEqual(parseRgbColor(null), null);
      assert.strictEqual(parseRgbColor(undefined), null);
      assert.strictEqual(parseRgbColor({}), null);
      assert.strictEqual(parseRgbColor([]), null);
    });
  });
});
