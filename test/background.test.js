const test = require('node:test');
const assert = require('node:assert');

// Mock browser API to avoid reference errors when requiring background.js
global.browser = {
  contextMenus: {
    create: () => {},
    remove: async () => {},
    onClicked: { addListener: () => {} }
  },
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} }
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    query: async () => []
  },
  alarms: {
    onAlarm: { addListener: () => {} }
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
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

// Also add chrome as a fallback in case browser doesn't cover something
global.chrome = global.browser;

const bg = require('../src/background.js');

test('cleanVideoId', () => {
  assert.strictEqual(bg.cleanVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.cleanVideoId('invalid-id'), null);
  assert.strictEqual(bg.cleanVideoId(' dQw4w9WgXcQ '), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.cleanVideoId(''), null);
  assert.strictEqual(bg.cleanVideoId(null), null);
  assert.strictEqual(bg.cleanVideoId(undefined), null);
  assert.strictEqual(bg.cleanVideoId('12345678901'), '12345678901');
  assert.strictEqual(bg.cleanVideoId('123456789012'), null);
});

test('extractVideoIdFromUrl', () => {
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/watch?v=invalid-id'), null);
  assert.strictEqual(bg.extractVideoIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.strictEqual(bg.extractVideoIdFromUrl('invalid-url'), null);
});

test('isYouTubeHost', () => {
  assert.strictEqual(bg.isYouTubeHost('youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('www.youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('m.youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('youtu.be'), true);
  assert.strictEqual(bg.isYouTubeHost('example.com'), false);
  assert.strictEqual(bg.isYouTubeHost('fakeyoutube.com'), false);
});

test('normalizeUrl', () => {
  assert.ok(bg.normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') instanceof URL);
  assert.strictEqual(bg.normalizeUrl('invalid-url'), null);
  assert.strictEqual(bg.normalizeUrl(null), null);
});
