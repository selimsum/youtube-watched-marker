const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Read background.js
const backgroundCode = fs.readFileSync("src/utils/extension.js", "utf8") + "\n" + fs.readFileSync("src/utils/youtube.js", "utf8") + "\n" + fs.readFileSync("src/background.js", "utf8");

// Mock the environment
const sandbox = {
  chrome: {
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    contextMenus: {
      onClicked: { addListener: () => {} },
      create: () => {},
      remove: async () => {}
    },
    tabs: {
      onCreated: { addListener: () => {} },
      onUpdated: { addListener: () => {} }
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  },
  console: { error: () => {}, log: () => {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Number: Number,
  String: String,
  Array: Array,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Promise: Promise,
  Object: Object,
  Boolean: Boolean,
  URL: URL,
  URLSearchParams: URLSearchParams
};

vm.createContext(sandbox);
vm.runInContext(backgroundCode, sandbox);

describe("normalizeUrl", () => {
  it("should return a URL object for valid URL strings", () => {
    const urlStr = "https://example.com/path?query=1";
    const result = sandbox.normalizeUrl(urlStr);
    assert.strictEqual(result instanceof URL, true);
    assert.strictEqual(result.href, urlStr);
  });

  it("should return null for invalid URL strings", () => {
    assert.strictEqual(sandbox.normalizeUrl("not-a-url"), null);
    assert.strictEqual(sandbox.normalizeUrl("http://"), null);
    assert.strictEqual(sandbox.normalizeUrl(""), null);
  });

  it("should return null for non-string inputs", () => {
    assert.strictEqual(sandbox.normalizeUrl(null), null);
    assert.strictEqual(sandbox.normalizeUrl(undefined), null);
    assert.strictEqual(sandbox.normalizeUrl(123), null);
    assert.strictEqual(sandbox.normalizeUrl(true), null);
    assert.strictEqual(sandbox.normalizeUrl({}), null);
    assert.strictEqual(sandbox.normalizeUrl([]), null);
  });
});

describe("normalizeSettingNumber", () => {
  it("should return the number when it's within bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(5, 10, 1, 20), 5);
    assert.strictEqual(sandbox.normalizeSettingNumber(15, 10, 1, 20), 15);
  });

  it("should return the minimum when the number is below bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(0, 10, 1, 20), 1);
    assert.strictEqual(sandbox.normalizeSettingNumber(-5, 10, 1, 20), 1);
  });

  it("should return the maximum when the number is above bounds", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(25, 10, 1, 20), 20);
    assert.strictEqual(sandbox.normalizeSettingNumber(100, 10, 1, 20), 20);
  });

  it("should round decimal numbers before bounding", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(5.4, 10, 1, 20), 5);
    assert.strictEqual(sandbox.normalizeSettingNumber(5.5, 10, 1, 20), 6);
    assert.strictEqual(sandbox.normalizeSettingNumber(0.4, 10, 1, 20), 1); // 0 rounded is 0, bounded is 1
  });

  it("should parse string numbers", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber("12", 10, 1, 20), 12);
    assert.strictEqual(sandbox.normalizeSettingNumber("5.6", 10, 1, 20), 6);
  });

  it("should return the fallback for invalid numbers", () => {
    assert.strictEqual(sandbox.normalizeSettingNumber(NaN, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(undefined, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber("abc", 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(Infinity, 10, 1, 20), 10);
    assert.strictEqual(sandbox.normalizeSettingNumber(-Infinity, 10, 1, 20), 10);
  });
});

describe("cleanVideoId", () => {
  it("should return the video ID for valid 11-character strings", () => {
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.cleanVideoId("12345678901"), "12345678901");
    assert.strictEqual(sandbox.cleanVideoId("aBcDeFgHiJk"), "aBcDeFgHiJk");
    assert.strictEqual(sandbox.cleanVideoId("-_abc123DEF"), "-_abc123DEF");
  });

  it("should trim leading and trailing whitespace", () => {
    assert.strictEqual(sandbox.cleanVideoId(" dQw4w9WgXcQ "), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.cleanVideoId("\tdQw4w9WgXcQ\n"), "dQw4w9WgXcQ");
  });

  it("should return null for invalid lengths", () => {
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9WgXc"), null); // 10 chars
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9WgXcQ1"), null); // 12 chars
  });

  it("should return null for invalid characters", () => {
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9W!XcQ"), null);
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9WgXc#"), null);
    assert.strictEqual(sandbox.cleanVideoId("dQw4w9WgXc "), null);
  });

  it("should return null for falsy values", () => {
    assert.strictEqual(sandbox.cleanVideoId(null), null);
    assert.strictEqual(sandbox.cleanVideoId(undefined), null);
    assert.strictEqual(sandbox.cleanVideoId(""), null);
    assert.strictEqual(sandbox.cleanVideoId(0), null);
    assert.strictEqual(sandbox.cleanVideoId(false), null);
  });

  it("should handle non-string types gracefully", () => {
    // Note: The function converts the value to a string first with String(value).
    // The number 12345678901 becomes "12345678901" which matches the 11 character length regex constraint
    assert.strictEqual(sandbox.cleanVideoId(12345678901), "12345678901");
    assert.strictEqual(sandbox.cleanVideoId({}), null);
    assert.strictEqual(sandbox.cleanVideoId([]), null);
  });
});

describe("cleanTitle", () => {
  it("should return empty string for falsy and non-string inputs", () => {
    assert.strictEqual(sandbox.cleanTitle(null), "");
    assert.strictEqual(sandbox.cleanTitle(undefined), "");
    assert.strictEqual(sandbox.cleanTitle(""), "");
    assert.strictEqual(sandbox.cleanTitle(0), "");
    assert.strictEqual(sandbox.cleanTitle(false), "");
    assert.strictEqual(sandbox.cleanTitle([]), "");
    assert.strictEqual(sandbox.cleanTitle({}), "");
  });

  it("should remove the trailing ' - YouTube' suffix", () => {
    assert.strictEqual(sandbox.cleanTitle("My Awesome Video - YouTube"), "My Awesome Video");
    assert.strictEqual(sandbox.cleanTitle("Another video - YouTube"), "Another video");
    assert.strictEqual(sandbox.cleanTitle("Just a video"), "Just a video"); // no suffix
  });

  it("should replace multiple spaces with a single space", () => {
    assert.strictEqual(sandbox.cleanTitle("A    video   with    spaces"), "A video with spaces");
    assert.strictEqual(sandbox.cleanTitle("A \t\n video"), "A video");
  });

  it("should trim leading and trailing whitespace", () => {
    assert.strictEqual(sandbox.cleanTitle("  Video Title  "), "Video Title");
    assert.strictEqual(sandbox.cleanTitle("\nVideo Title\t"), "Video Title");
  });

  it("should perform all cleanup operations together", () => {
    // Note: the implementation replaces space then trailing ` - YouTube`, so space before hyphen needs to be 1 space.
    // E.g., `   My   Awesome \t Video   - YouTube   ` -> `My Awesome Video - YouTube ` -> `My Awesome Video - YouTube`
    // We should test strings that when spaces are replaced, match " - YouTube$" after trim or before trim
    assert.strictEqual(sandbox.cleanTitle("   My   Awesome \t Video   - YouTube"), "My Awesome Video");
  });
});

describe("extractVideoIdFromUrl", () => {
  it("should extract video ID from standard /watch?v= URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("http://youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from shortened youtu.be/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("http://youtu.be/dQw4w9WgXcQ?t=123"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /shorts/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /embed/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should extract video ID from /live/ URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("should return null for invalid or non-YouTube URLs", () => {
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("not-a-url"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl(null), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl(""), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/"), null);
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/playlist?list=PLxyz"), null);
  });

  it("should return null for malformed video IDs", () => {
    // Too short
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXc"), null);
    // Too long
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ1"), null);
    // Invalid characters
    assert.strictEqual(sandbox.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9W!XcQ"), null);
  });
});

describe("getActiveQueueCount", () => {
  it("should return 0 for an empty queue", () => {
    assert.strictEqual(sandbox.getActiveQueueCount([]), 0);
  });

  it("should count only 'pending' items", () => {
    const queue = [
      { status: "pending" },
      { status: "completed" },
      { status: "error" },
      { status: "pending" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 2);
  });

  it("should count only 'running' items", () => {
    const queue = [
      { status: "running" },
      { status: "completed" },
      { status: "running" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 2);
  });

  it("should count both 'pending' and 'running' items", () => {
    const queue = [
      { status: "pending" },
      { status: "running" },
      { status: "completed" },
      { status: "error" },
      { status: "running" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 3);
  });

  it("should return 0 when there are no active items", () => {
    const queue = [
      { status: "completed" },
      { status: "error" },
      { status: "cancelled" }
    ];
    assert.strictEqual(sandbox.getActiveQueueCount(queue), 0);
  });
});

describe("normalizeUrl", () => {
  it("should return a URL object for a valid URL string", () => {
    const url = sandbox.normalizeUrl("https://example.com/path?query=1");
    assert.ok(url instanceof URL);
    assert.strictEqual(url.href, "https://example.com/path?query=1");
  });

  it("should return null for an invalid URL string", () => {
    assert.strictEqual(sandbox.normalizeUrl("not-a-url"), null);
    assert.strictEqual(sandbox.normalizeUrl("http://"), null);
  });

  it("should return null for non-string inputs", () => {
    assert.strictEqual(sandbox.normalizeUrl(null), null);
    assert.strictEqual(sandbox.normalizeUrl(undefined), null);
    assert.strictEqual(sandbox.normalizeUrl(123), null);
    assert.strictEqual(sandbox.normalizeUrl({}), null);
    assert.strictEqual(sandbox.normalizeUrl([]), null);
    assert.strictEqual(sandbox.normalizeUrl(true), null);
  });

  it("should return null for empty string", () => {
    assert.strictEqual(sandbox.normalizeUrl(""), null);
  });
});

describe("closeTabQuietly", () => {
  let originalTabsRemove;

  beforeEach(() => {
    sandbox.throwError = false;
    sandbox.removeCalledWith = null;

    // Ensure extensionApi and extensionApi.tabs are initialized
    if (!sandbox.extensionApi) sandbox.extensionApi = {};
    if (!sandbox.extensionApi.tabs) sandbox.extensionApi.tabs = {};

    originalTabsRemove = sandbox.extensionApi.tabs.remove;

    vm.runInContext(`
      if (typeof extensionApi === 'undefined') {
        globalThis.extensionApi = { tabs: {} };
      } else if (!extensionApi.tabs) {
        extensionApi.tabs = {};
      }

      extensionApi.tabs.remove = async (tabId) => {
        globalThis.removeCalledWith = tabId;
        if (globalThis.throwError) {
          throw new Error("Tab already closed");
        }
      };
    `, sandbox);
  });

  afterEach(() => {
    if (sandbox.extensionApi && sandbox.extensionApi.tabs) {
      sandbox.extensionApi.tabs.remove = originalTabsRemove;
    }
  });

  it("should call extensionApi.tabs.remove with correct tabId", async () => {
    await sandbox.closeTabQuietly(123);
    assert.strictEqual(sandbox.removeCalledWith, 123);
  });

  it("should catch errors thrown by extensionApi.tabs.remove", async () => {
    sandbox.throwError = true;

    // Should not throw
    await sandbox.closeTabQuietly(456);
    assert.strictEqual(sandbox.removeCalledWith, 456);
  });
});
describe("formatBounds", () => {
  it("should return a formatted string with valid bounds", () => {
    assert.strictEqual(sandbox.formatBounds({ left: 10, top: 20, width: 800, height: 600 }), "10,20,800x600");
  });

  it("should handle negative bounds and zeroes", () => {
    assert.strictEqual(sandbox.formatBounds({ left: -10, top: 0, width: 0, height: -50 }), "-10,0,0x-50");
  });

  it("should handle missing properties by stringifying as undefined", () => {
    assert.strictEqual(sandbox.formatBounds({ left: 10, width: 800 }), "10,undefined,800xundefined");
  });

  it("should throw an error for null or undefined input", () => {
    assert.throws(() => {
      sandbox.formatBounds(null);
    }, (err) => {
      return err.name === "TypeError";
    });
    assert.throws(() => {
      sandbox.formatBounds(undefined);
    }, (err) => {
      return err.name === "TypeError";
    });
  });
});
