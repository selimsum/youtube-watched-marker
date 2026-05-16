const { describe, it } = require('mocha');
const assert = require('assert');

// Mock extension APIs so background.js doesn't fail on require
global.chrome = {
  tabs: {
    onUpdated: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    query: () => Promise.resolve([])
  },
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} }
  },
  contextMenus: {
    removeAll: () => {},
    onClicked: { addListener: () => {} },
    remove: () => Promise.resolve(),
    create: () => {}
  },
  alarms: {
    clear: () => {},
    onAlarm: { addListener: () => {} }
  },
  storage: {
    local: {
      get: () => Promise.resolve({watchQueue: []}),
      set: () => Promise.resolve()
    },
    onChanged: { addListener: () => {} }
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  browserAction: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  }
};

const bg = require('../src/background.js');

describe("urlsMatchIgnoringEncoding", () => {
  it("should match urls", () => {
  const { urlsMatchIgnoringEncoding } = bg;



  // Basic equality
  assert.strictEqual(
    urlsMatchIgnoringEncoding('https://example.com/watch?v=123', 'https://example.com/watch?v=123'),
    true,
    'Identical URLs should match'
  );

  // Decoding test
  assert.strictEqual(
    urlsMatchIgnoringEncoding('https://example.com/watch?v=abc%20def', 'https://example.com/watch?v=abc def'),
    true,
    'URLs should match when one is encoded'
  );

  // Different URLs
  assert.strictEqual(
    urlsMatchIgnoringEncoding('https://example.com/watch?v=123', 'https://example.com/watch?v=456'),
    false,
    'Different URLs should not match'
  );

  // Invalid URLs (not matched by identity but should fall back)
  assert.strictEqual(
    urlsMatchIgnoringEncoding('not-a-url', 'not-a-url'),
    true,
    'Identical invalid URLs should match'
  );

  // Invalid URLs different
  assert.strictEqual(
    urlsMatchIgnoringEncoding('not-a-url-1', 'not-a-url-2'),
    false,
    'Different invalid URLs should not match'
  );

  // Null checks
  assert.strictEqual(
    urlsMatchIgnoringEncoding(null, 'https://example.com'),
    false,
    'Null actual URL should return false'
  );

  assert.strictEqual(
    urlsMatchIgnoringEncoding('https://example.com', undefined),
    false,
    'Undefined expected URL should return false'
  );


  });
});
