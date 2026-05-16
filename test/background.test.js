const test = require('node:test');
const assert = require('assert');

// Mock chrome before requiring background.js
global.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onSuspend: { addListener: () => {} },
    onSuspendCanceled: { addListener: () => {} },
    getManifest: () => ({ version: "1.0.0" })
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  browserAction: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  contextMenus: {
    onClicked: { addListener: () => {} },
    create: () => {},
    update: () => {},
    remove: () => Promise.resolve()
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    query: () => Promise.resolve([])
  },
  windows: {
    onRemoved: { addListener: () => {} },
    onFocusChanged: { addListener: () => {} },
    onBoundsChanged: { addListener: () => {} }
  },
  storage: {
    local: { get: () => Promise.resolve({ watchQueue: [] }), set: () => {} },
    onChanged: { addListener: () => {} }
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {}
  }
};

const { isYouTubeHost } = require('../src/background.js');

test('isYouTubeHost', (t) => {
  // Happy paths
  assert.strictEqual(isYouTubeHost('youtube.com'), true);
  assert.strictEqual(isYouTubeHost('www.youtube.com'), true);
  assert.strictEqual(isYouTubeHost('m.youtube.com'), true);
  assert.strictEqual(isYouTubeHost('music.youtube.com'), true);
  assert.strictEqual(isYouTubeHost('youtu.be'), true);

  // Edge cases
  assert.strictEqual(isYouTubeHost('YOUTUBE.COM'), true);
  assert.strictEqual(isYouTubeHost('WWW.YOUTUBE.COM'), true);
  assert.strictEqual(isYouTubeHost('random.youtube.com'), true);

  // Error conditions
  assert.strictEqual(isYouTubeHost('example.com'), false);
  assert.strictEqual(isYouTubeHost('youtube.com.org'), false);
  assert.strictEqual(isYouTubeHost('notyoutube.com'), false);

  // Verify handling of null/undefined
  assert.strictEqual(isYouTubeHost(''), false);
  assert.strictEqual(isYouTubeHost(null), false);
  assert.strictEqual(isYouTubeHost(undefined), false);
});
