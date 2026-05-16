const { describe, it } = require("mocha");
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');

// Mock context for popup.js
function setupContext() {
  const context = {
    document: {
      getElementById: () => ({ addEventListener: () => {}, textContent: '', value: '' })
    },
    console: { error: () => {} },
    window: { screen: {} },
    browser: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve()
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

describe("popup.js formatWindowBounds", () => {
  const context = setupContext();
  const formatWindowBounds = context.formatWindowBounds;

  it('returns default message for falsy bounds', () => {
    assert.strictEqual(formatWindowBounds(null), "Worker window: default position");
    assert.strictEqual(formatWindowBounds(undefined), "Worker window: default position");
  });

  it('formats full bounds', () => {
    assert.strictEqual(
      formatWindowBounds({ left: 10, top: 20, width: 800, height: 600 }),
      "Worker window: x 10, y 20, 800w, 600h"
    );
  });

  it('formats partial bounds', () => {
    assert.strictEqual(
      formatWindowBounds({ width: 800, height: 600 }),
      "Worker window: 800w, 600h"
    );
    assert.strictEqual(
      formatWindowBounds({ left: 10, top: 20 }),
      "Worker window: x 10, y 20"
    );
  });

  it('handles zeroes properly', () => {
    assert.strictEqual(
      formatWindowBounds({ left: 0, top: 0, width: 0, height: 0 }),
      "Worker window: x 0, y 0, 0w, 0h"
    );
  });

  it('ignores non-finite numbers', () => {
    assert.strictEqual(
      formatWindowBounds({ left: NaN, top: Infinity, width: "100", height: null }),
      "Worker window: default position"
    );
  });
});
