const assert = require('assert');

// Mock Chrome extension APIs before requiring the background script
global.chrome = {
  storage: { local: { get: () => ({}), set: () => ({}) } },
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} }
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    query: () => Promise.resolve([])
  },
  contextMenus: {
    onClicked: { addListener: () => {} },
    create: () => {},
    remove: () => Promise.resolve()
  },
  browserAction: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  }
};

const { normalizeSettingNumber } = require("../src/background.js");

function testNormalizeSettingNumber() {
  console.log("Testing normalizeSettingNumber...");

  // Happy paths
  assert.strictEqual(normalizeSettingNumber(10, 5, 1, 20), 10, "Value within bounds should return value");
  assert.strictEqual(normalizeSettingNumber(1, 5, 1, 20), 1, "Value exactly equal to minimum should return minimum");
  assert.strictEqual(normalizeSettingNumber(20, 5, 1, 20), 20, "Value exactly equal to maximum should return maximum");
  assert.strictEqual(normalizeSettingNumber(0, 5), 0, "Value without min/max constraints should return value");

  // Edge cases: Coercion
  assert.strictEqual(normalizeSettingNumber("15", 5, 1, 20), 15, "String number within bounds should be parsed and returned");
  assert.strictEqual(normalizeSettingNumber(10.5, 5, 1, 20), 10.5, "Float value should be retained");

  // Edge cases: Bounds limits
  assert.strictEqual(normalizeSettingNumber(0, 5, 1, 20), 1, "Value below minimum should return minimum");
  assert.strictEqual(normalizeSettingNumber(30, 5, 1, 20), 20, "Value above maximum should return maximum");
  assert.strictEqual(normalizeSettingNumber(30, 5, 1), 30, "Value above maximum where maximum is not provided should return value");
  assert.strictEqual(normalizeSettingNumber(-5, 5, undefined, 20), -5, "Value below minimum where minimum is not provided should return value");

  // Error conditions: Non-finite inputs
  assert.strictEqual(normalizeSettingNumber("invalid", 5, 1, 20), 5, "Non-numeric string should return fallback");
  assert.strictEqual(normalizeSettingNumber(NaN, 5, 1, 20), 5, "NaN should return fallback");
  assert.strictEqual(normalizeSettingNumber(Infinity, 5, 1, 20), 5, "Infinity should return fallback");
  assert.strictEqual(normalizeSettingNumber(-Infinity, 5, 1, 20), 5, "-Infinity should return fallback");
  assert.strictEqual(normalizeSettingNumber(undefined, 5, 1, 20), 5, "undefined should return fallback");

  console.log("All tests passed!");
}

testNormalizeSettingNumber();
