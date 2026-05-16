const test = require('node:test');
const assert = require('node:assert');

// Mock browser globals so youtube-content.js can load
global.chrome = {
  runtime: {
    sendMessage: () => Promise.resolve({}),
    onMessage: { addListener: () => {} }
  }
};
global.window = {
  location: { origin: 'https://youtube.com', pathname: '' },
  addEventListener: () => {}
};
global.Node = {
  ELEMENT_NODE: 1
};
global.document = {
  addEventListener: () => {},
  documentElement: {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: () => []
  },
  querySelector: () => null,
  body: {}
};
global.MutationObserver = class {
  observe() {}
};

const { getRelativeUnitDays } = require('../src/youtube-content.js');

test('getRelativeUnitDays returns correct multipliers', (t) => {
  // minutes
  assert.strictEqual(getRelativeUnitDays("minute"), 1 / (24 * 60));
  assert.strictEqual(getRelativeUnitDays("minutes"), 1 / (24 * 60));

  // hours
  assert.strictEqual(getRelativeUnitDays("hour"), 1 / 24);
  assert.strictEqual(getRelativeUnitDays("hours"), 1 / 24);

  // days
  assert.strictEqual(getRelativeUnitDays("day"), 1);
  assert.strictEqual(getRelativeUnitDays("days"), 1);

  // weeks
  assert.strictEqual(getRelativeUnitDays("week"), 7);
  assert.strictEqual(getRelativeUnitDays("weeks"), 7);

  // months
  assert.strictEqual(getRelativeUnitDays("month"), 30.436875);
  assert.strictEqual(getRelativeUnitDays("months"), 30.436875);

  // years
  assert.strictEqual(getRelativeUnitDays("year"), 365.2425);
  assert.strictEqual(getRelativeUnitDays("years"), 365.2425);
});

test('getRelativeUnitDays returns 0 for invalid or unrecognized units', (t) => {
  assert.strictEqual(getRelativeUnitDays("second"), 0);
  assert.strictEqual(getRelativeUnitDays("seconds"), 0);
  assert.strictEqual(getRelativeUnitDays("decade"), 0);
  assert.strictEqual(getRelativeUnitDays("saniye"), 0);
  assert.strictEqual(getRelativeUnitDays("saat"), 0);
  assert.strictEqual(getRelativeUnitDays("gun"), 0);
  assert.strictEqual(getRelativeUnitDays("hafta"), 0);
  assert.strictEqual(getRelativeUnitDays("ay"), 0);
  assert.strictEqual(getRelativeUnitDays("yil"), 0);
  assert.strictEqual(getRelativeUnitDays(""), 0);
  assert.strictEqual(getRelativeUnitDays(null), 0);
  assert.strictEqual(getRelativeUnitDays(undefined), 0);
  assert.strictEqual(getRelativeUnitDays(123), 0);
});
