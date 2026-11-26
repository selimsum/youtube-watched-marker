"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadSeedHook({ initialData, fetchImpl } = {}) {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "youtube-seed-hook.js"),
    "utf8"
  );

  const appended = [];
  function FakeXMLHttpRequest() {}
  FakeXMLHttpRequest.prototype.open = function () {};
  FakeXMLHttpRequest.prototype.send = function () {};
  FakeXMLHttpRequest.prototype.addEventListener = function () {};

  class FakeHeaders {
    constructor(init = {}) {
      this.map = new Map();
      if (init instanceof FakeHeaders) {
        for (const [k, v] of init.map.entries()) this.map.set(k, v);
      } else {
        for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), String(v));
      }
    }
    delete(k) { this.map.delete(k.toLowerCase()); }
    has(k) { return this.map.has(k.toLowerCase()); }
    get(k) { return this.map.get(k.toLowerCase()) || null; }
  }

  class FakeResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.statusText = init.statusText || "OK";
      this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers);
      this.ok = this.status >= 200 && this.status < 300;
    }
    clone() { return new FakeResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers }); }
    async json() { return JSON.parse(this.body); }
  }

  const windowObj = {
    ytInitialData: initialData,
    fetch: fetchImpl || (async () => new FakeResponse("{}"))
  };
  windowObj.window = windowObj;

  const context = {
    window: windowObj,
    location: { search: "", pathname: "/feed/subscriptions" },
    document: {
      documentElement: { appendChild: (el) => appended.push(el) },
      head: { appendChild: (el) => appended.push(el) },
      createElement: () => ({ id: "", textContent: "" }),
      addEventListener: () => {}
    },
    MutationObserver: function () { return { observe: () => {} }; },
    HTMLVideoElement: { prototype: { play: () => {} } },
    XMLHttpRequest: FakeXMLHttpRequest,
    Headers: FakeHeaders,
    Response: FakeResponse,
    WeakSet,
    Object,
    Array,
    JSON,
    console
  };
  // Top-level `window.ytInitialData` in vm uses context.window, while global bare references use context.
  Object.assign(context, {
    fetch: windowObj.fetch
  });

  vm.createContext(context);
  vm.runInContext(code, context, { filename: "src/youtube-seed-hook.js" });
  return { context, windowObj, appended, FakeHeaders, FakeResponse };
}

function makeVideoRendererMenu() {
  return {
    videoRenderer: {
      videoId: "dQw4w9WgXcQ",
      menu: {
        menuRenderer: {
          items: [
            { menuServiceItemRenderer: { text: { runs: [{ text: "Save to Watch later" }] } } }
          ]
        }
      }
    }
  };
}

test("preserves pre-existing window.ytInitialData and injects Mark as watched", () => {
  const existing = makeVideoRendererMenu();
  const { windowObj, appended } = loadSeedHook({ initialData: existing });

  assert.ok(windowObj.ytInitialData, "ytInitialData must not be wiped to undefined");
  const items = windowObj.ytInitialData.videoRenderer.menu.menuRenderer.items;
  assert.equal(items.length, 2);
  assert.equal(items[1].menuServiceItemRenderer.text.runs[0].text, "Mark as watched");
  assert.ok(appended[0].textContent.includes("ytd-popup-container tp-yt-iron-dropdown"));
});

test("injects Mark watched & remove in playlist context and skips sort/selection menus", () => {
  const { windowObj } = loadSeedHook();
  const playlistPayload = {
    playlistVideoRenderer: {
      videoId: "abcDEF_1234",
      playlistSetVideoId: "SET123",
      menu: {
        menuRenderer: {
          items: [
            {
              menuServiceItemRenderer: {
                text: { runs: [{ text: "Remove from Watch later" }] },
                serviceEndpoint: {
                  playlistEditEndpoint: {
                    actions: [{ action: "ACTION_REMOVE_VIDEO" }]
                  }
                }
              }
            }
          ]
        }
      }
    },
    sortFilterSubMenuRenderer: {
      items: [
        { menuServiceItemRenderer: { text: { runs: [{ text: "Date added (newest)" }] }, isSelected: true } }
      ]
    }
  };

  windowObj.ytInitialData = playlistPayload;

  const playlistItems = windowObj.ytInitialData.playlistVideoRenderer.menu.menuRenderer.items;
  assert.deepEqual(
    playlistItems.map((i) => i.menuServiceItemRenderer.text.runs[0].text),
    ["Remove from Watch later", "Mark as watched", "Mark watched & remove"]
  );
  assert.equal(
    playlistItems[2].menuServiceItemRenderer.serviceEndpoint.playlistEditEndpoint.actions[0].action,
    "ACTION_REMOVE_VIDEO"
  );

  assert.equal(windowObj.ytInitialData.sortFilterSubMenuRenderer.items.length, 1);
});

test("fetch hook intercepts menu-bearing endpoints, strips content-length/encoding, and bypasses telemetry", async () => {
  let fetchedUrls = [];
  const { windowObj, FakeHeaders, FakeResponse } = loadSeedHook({
    fetchImpl: async (url) => {
      fetchedUrls.push(url);
      if (url.includes("/youtubei/v1/browse")) {
        return new FakeResponse(JSON.stringify(makeVideoRendererMenu()), {
          status: 200,
          headers: new FakeHeaders({
            "content-type": "application/json",
            "content-length": "123",
            "content-encoding": "gzip"
          })
        });
      }
      return new FakeResponse("{\"ok\":true}", {
        status: 200,
        headers: new FakeHeaders({ "content-length": "11" })
      });
    }
  });

  const browseRes = await windowObj.fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false");
  assert.equal(browseRes.headers.has("content-length"), false);
  assert.equal(browseRes.headers.has("content-encoding"), false);
  const browseJson = await browseRes.json();
  assert.equal(browseJson.videoRenderer.menu.menuRenderer.items.length, 2);

  const logRes = await windowObj.fetch("https://www.youtube.com/youtubei/v1/log_event");
  assert.equal(logRes.headers.get("content-length"), "11");
  assert.deepEqual(fetchedUrls, [
    "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
    "https://www.youtube.com/youtubei/v1/log_event"
  ]);
});
