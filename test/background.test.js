const { describe, it } = require("mocha");
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

global.getExtensionApi = () => global.browser;

const bg = require('../src/background.js');

describe("cleanTitle", () => {
  it("should return empty string for falsy or non-string inputs", () => {
    assert.strictEqual(bg.cleanTitle(null), "");
    assert.strictEqual(bg.cleanTitle(undefined), "");
    assert.strictEqual(bg.cleanTitle(""), "");
    assert.strictEqual(bg.cleanTitle(123), "");
    assert.strictEqual(bg.cleanTitle({}), "");
    assert.strictEqual(bg.cleanTitle(true), "");
  });

  it("should trim leading and trailing whitespace", () => {
    assert.strictEqual(bg.cleanTitle("  Some Title  "), "Some Title");
    assert.strictEqual(bg.cleanTitle("\nTitle\t"), "Title");
  });

  it("should collapse multiple consecutive spaces", () => {
    assert.strictEqual(bg.cleanTitle("Some    Long   Title"), "Some Long Title");
    assert.strictEqual(bg.cleanTitle("Title \n \t With \r Spaces"), "Title With Spaces");
  });

  it("should remove ' - YouTube' suffix", () => {
    assert.strictEqual(bg.cleanTitle("Awesome Video - YouTube"), "Awesome Video");
    assert.strictEqual(bg.cleanTitle("  Awesome Video - YouTube  "), "Awesome Video");
    assert.strictEqual(bg.cleanTitle("Awesome Video - YouTube Channel"), "Awesome Video - YouTube Channel"); // Should only remove at the end
    assert.strictEqual(bg.cleanTitle("Awesome Video- YouTube"), "Awesome Video- YouTube"); // Must match the space before dash
  });

  it("should handle combinations of issues", () => {
    assert.strictEqual(bg.cleanTitle("  Very   Messy   Title  - YouTube  "), "Very Messy Title");
  });
});

describe("cleanVideoId", () => {
  it("should work", () => {
  assert.strictEqual(bg.cleanVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.cleanVideoId('invalid-id'), null);
  assert.strictEqual(bg.cleanVideoId(' dQw4w9WgXcQ '), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.cleanVideoId(''), null);
  assert.strictEqual(bg.cleanVideoId(null), null);
  assert.strictEqual(bg.cleanVideoId(undefined), null);
  assert.strictEqual(bg.cleanVideoId('12345678901'), '12345678901');
  assert.strictEqual(bg.cleanVideoId('123456789012'), null);
    });
});

describe("extractVideoIdFromUrl", () => {
  it("should work", () => {
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(bg.extractVideoIdFromUrl('https://www.youtube.com/watch?v=invalid-id'), null);
  assert.strictEqual(bg.extractVideoIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.strictEqual(bg.extractVideoIdFromUrl('invalid-url'), null);
    });
});

describe("isWorkerWatchUrl", () => {
  it("should return true for valid YouTube worker URLs", () => {
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1"), true);
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/watch?ytwm_worker=1&v=dQw4w9WgXcQ"), true);
  });

  it("should return false for YouTube URLs without the worker param", () => {
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=0"), false);
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker="), false);
  });

  it("should return false for non-YouTube URLs with the worker param", () => {
    assert.strictEqual(bg.isWorkerWatchUrl("https://example.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1"), false);
    assert.strictEqual(bg.isWorkerWatchUrl("https://notyoutube.com/watch?ytwm_worker=1"), false);
  });

  it("should return false for invalid URLs and null/undefined values", () => {
    assert.strictEqual(bg.isWorkerWatchUrl("invalid-url"), false);
    assert.strictEqual(bg.isWorkerWatchUrl(""), false);
    assert.strictEqual(bg.isWorkerWatchUrl(null), false);
    assert.strictEqual(bg.isWorkerWatchUrl(undefined), false);
  });

  it("should handle mobile/shorts/music YouTube URLs correctly", () => {
    assert.strictEqual(bg.isWorkerWatchUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1"), true);
    assert.strictEqual(bg.isWorkerWatchUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1"), true);
    assert.strictEqual(bg.isWorkerWatchUrl("https://youtu.be/dQw4w9WgXcQ?ytwm_worker=1"), true);
    assert.strictEqual(bg.isWorkerWatchUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ?ytwm_worker=1"), true);
  });
});

describe("isYouTubeHost", () => {
  it("should work", () => {
  assert.strictEqual(bg.isYouTubeHost('youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('www.youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('m.youtube.com'), true);
  assert.strictEqual(bg.isYouTubeHost('youtu.be'), true);
  assert.strictEqual(bg.isYouTubeHost('example.com'), false);
  assert.strictEqual(bg.isYouTubeHost('fakeyoutube.com'), false);
    });
});

describe("normalizeUrl", () => {
  it("should work", () => {
  assert.ok(bg.normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') instanceof URL);
  assert.strictEqual(bg.normalizeUrl('invalid-url'), null);
  assert.strictEqual(bg.normalizeUrl(null), null);
    });
});
