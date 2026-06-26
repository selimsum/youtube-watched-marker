const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read popup.js
const popupCode = fs.readFileSync("src/utils/extension.js", "utf8") + "\n" + fs.readFileSync("popup/popup.js", "utf8");

// Mock the environment
const sandbox = {
  chrome: {
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} }
    }
  },
  document: {
    getElementById: () => ({
      addEventListener: () => {},
      appendChild: () => {},
      setAttribute: () => {},
      getAttribute: () => "false",
      classList: { toggle: () => {} },
      replaceChildren: () => {},
      append: () => {},
      value: "",
      disabled: false,
      hidden: false
    }),
    createElement: () => ({
      addEventListener: () => {},
      append: () => {},
      classList: { toggle: () => {} },
      setAttribute: () => {},
      remove: () => {},
      click: () => {},
      className: "",
      textContent: "",
      title: "",
      type: ""
    }),
    body: {
      classList: { toggle: () => {} },
      append: () => {}
    }
  },
  window: {
    URL: { createObjectURL: () => "", revokeObjectURL: () => {} }
  },
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  Blob: class Blob {},
  console: { error: () => {}, log: () => {} },
  setTimeout: () => {},
  Number: Number,
  String: String,
  Array: Array,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Promise: Promise,
  Object: Object
};

vm.createContext(sandbox);
vm.runInContext(popupCode, sandbox);

describe("formatDate", () => {
  it("should format valid dates correctly", () => {
    const date = new Date("2023-01-01T12:00:00Z");
    const result = sandbox.formatDate(date.getTime());
    const expected = date.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    });

    assert.strictEqual(result, expected);
  });

  it("should return an empty string for invalid dates", () => {
    assert.strictEqual(sandbox.formatDate("not a date"), "");
    assert.strictEqual(sandbox.formatDate(NaN), "");
  });

  it("should format a date string correctly", () => {
    const dateStr = "2023-05-15T08:30:00Z";
    const date = new Date(dateStr);
    const result = sandbox.formatDate(dateStr);
    const expected = date.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    });

    assert.strictEqual(result, expected);
  });
});

describe("isOldestDateShortcut", () => {
  it("should return true for valid shortcuts", () => {
    assert.strictEqual(sandbox.isOldestDateShortcut("oldest"), true);
    assert.strictEqual(sandbox.isOldestDateShortcut("end"), true);
  });

  it("should handle mixed case and whitespace", () => {
    assert.strictEqual(sandbox.isOldestDateShortcut(" OLDEST "), true);
    assert.strictEqual(sandbox.isOldestDateShortcut("End"), true);
    assert.strictEqual(sandbox.isOldestDateShortcut("   end   "), true);
  });

  it("should return false for invalid strings", () => {
    assert.strictEqual(sandbox.isOldestDateShortcut("0"), false);
    assert.strictEqual(sandbox.isOldestDateShortcut("invalid"), false);
    assert.strictEqual(sandbox.isOldestDateShortcut(""), false);
    assert.strictEqual(sandbox.isOldestDateShortcut("   "), false);
  });

  it("should return false for null and undefined", () => {
    assert.strictEqual(sandbox.isOldestDateShortcut(null), false);
    assert.strictEqual(sandbox.isOldestDateShortcut(undefined), false);
  });
});
