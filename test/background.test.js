const { describe, it } = require('node:test');
const assert = require('node:assert');

// Mock Chrome Extension API before importing the file
global.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  },
  contextMenus: {
    onClicked: { addListener: () => {} },
    create: () => {},
    remove: () => Promise.resolve()
  },
  tabs: {
    onCreated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    query: () => Promise.resolve([])
  },
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve()
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

const { extractVideoIdFromUrl } = require('../src/background.js');

describe('extractVideoIdFromUrl', () => {
  it('extracts ID from standard watch URL', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('extracts ID from shorts URL', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('extracts ID from live URL', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('extracts ID from youtu.be URL', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.example.com/watch?v=dQw4w9WgXcQ'), null);
  });

  it('returns null for invalid video IDs', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/watch?v=too_short'), null);
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/watch?v=this_id_is_way_too_long'), null);
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/watch?v=invalid@id!'), null);
  });

  it('returns null for empty or invalid URLs', () => {
    assert.strictEqual(extractVideoIdFromUrl(''), null);
    assert.strictEqual(extractVideoIdFromUrl(null), null);
    assert.strictEqual(extractVideoIdFromUrl('not a url'), null);
  });

  it('extracts ID from URLs with additional parameters', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  });

  it('extracts ID from youtu.be URLs with additional parameters', () => {
    assert.strictEqual(extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  });
});
