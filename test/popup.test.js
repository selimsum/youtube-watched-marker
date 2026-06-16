const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read extension utils and popup.js
const utilsCode = fs.readFileSync("src/utils/extension.js", "utf8");
const popupCode = fs.readFileSync("popup/popup.js", "utf8");

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
vm.runInContext(utilsCode, sandbox);
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

describe("parseInputDate", () => {
  it("should parse valid YYYY-MM-DD dates", () => {
    const result = sandbox.parseInputDate("2023-05-15");
    assert.strictEqual(result.getTime(), new Date(2023, 4, 15).getTime());
  });

  it("should parse valid DD.MM.YYYY dates", () => {
    const result = sandbox.parseInputDate("15.05.2023");
    assert.strictEqual(result.getTime(), new Date(2023, 4, 15).getTime());
  });

  it("should handle single-digit days and months in YYYY-MM-DD format", () => {
    const result = sandbox.parseInputDate("2023-5-5");
    assert.strictEqual(result.getTime(), new Date(2023, 4, 5).getTime());
  });

  it("should handle single-digit days and months in DD.MM.YYYY format", () => {
    const result = sandbox.parseInputDate("5.5.2023");
    assert.strictEqual(result.getTime(), new Date(2023, 4, 5).getTime());
  });

  it("should handle whitespace", () => {
    const result = sandbox.parseInputDate("  2023-05-15  ");
    assert.strictEqual(result.getTime(), new Date(2023, 4, 15).getTime());
  });

  it("should return null for invalid dates that don't exist", () => {
    assert.strictEqual(sandbox.parseInputDate("2023-02-29"), null); // Not a leap year
    assert.strictEqual(sandbox.parseInputDate("2023-13-01"), null);
    assert.strictEqual(sandbox.parseInputDate("29.02.2023"), null);
  });

  it("should return null for invalid string formats", () => {
    assert.strictEqual(sandbox.parseInputDate("not a date"), null);
    assert.strictEqual(sandbox.parseInputDate("2023/05/15"), null);
    assert.strictEqual(sandbox.parseInputDate("2023-05"), null);
  });

  it("should return null for empty, null, or undefined inputs", () => {
    assert.strictEqual(sandbox.parseInputDate(""), null);
    assert.strictEqual(sandbox.parseInputDate(null), null);
    assert.strictEqual(sandbox.parseInputDate(undefined), null);
  });
});
