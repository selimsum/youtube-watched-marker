"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createMockBackground(options = {}) {
  const root = path.join(__dirname, "..");
  const storageData = { ...(options.initialStorage || {}) };
  const calls = {
    windowsCreate: [],
    windowsRemove: [],
    windowsUpdate: [],
    tabsCreate: [],
    tabsRemove: [],
    tabsUpdate: [],
    executeScript: [],
    sendMessageToTab: []
  };

  let nextWindowId = 100;
  let nextTabId = 200;
  const openWindows = new Map([[1, { id: 1, type: "normal", left: 0, top: 0, width: 1400, height: 900, focused: true }]]);
  const openTabs = new Map([[10, { id: 10, windowId: 1, url: "https://www.youtube.com/", title: "Home - YouTube", active: true, status: "complete" }]]);

  const tabOnUpdatedListeners = new Set();
  const tabOnRemovedListeners = new Set();
  const runtimeOnMessageListeners = new Set();
  const contextMenuOnClickedListeners = new Set();

  const browser = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return Object.prototype.hasOwnProperty.call(storageData, keys) ? { [keys]: storageData[keys] } : {};
          }
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) {
              if (Object.prototype.hasOwnProperty.call(storageData, k)) out[k] = storageData[k];
            }
            return out;
          }
          return { ...storageData };
        },
        async set(patch) {
          Object.assign(storageData, patch);
        },
        async remove(key) {
          if (Array.isArray(key)) {
            for (const k of key) delete storageData[k];
          } else {
            delete storageData[key];
          }
        }
      }
    },
    browserAction: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {}
    },
    contextMenus: {
      async remove() {},
      create() {},
      onClicked: {
        addListener(fn) { contextMenuOnClickedListeners.add(fn); }
      }
    },
    windows: {
      async create(opts) {
        calls.windowsCreate.push(opts);
        const id = ++nextWindowId;
        const tabId = ++nextTabId;
        const tab = { id: tabId, windowId: id, url: opts.url, status: "complete", active: true };
        const win = { id, type: opts.type || "popup", left: opts.left ?? 50, top: opts.top ?? 50, width: opts.width || 1280, height: opts.height || 720, tabs: [tab] };
        openWindows.set(id, win);
        openTabs.set(tabId, tab);
        return win;
      },
      async get(id, opts) {
        const win = openWindows.get(id);
        if (!win) throw new Error("window-not-found");
        if (opts && opts.populate) {
          return { ...win, tabs: Array.from(openTabs.values()).filter((t) => t.windowId === id) };
        }
        return { ...win };
      },
      async update(id, patch) {
        calls.windowsUpdate.push({ id, patch });
        const win = openWindows.get(id);
        if (!win) throw new Error("window-not-found");
        Object.assign(win, patch);
        return { ...win };
      },
      async remove(id) {
        calls.windowsRemove.push(id);
        if (!openWindows.has(id)) throw new Error("window-not-found");
        openWindows.delete(id);
        for (const [tid, tab] of openTabs.entries()) {
          if (tab.windowId === id) openTabs.delete(tid);
        }
      }
    },
    tabs: {
      async create(opts) {
        calls.tabsCreate.push(opts);
        const id = ++nextTabId;
        const tab = { id, windowId: 1, url: opts.url, status: "complete", active: Boolean(opts.active) };
        openTabs.set(id, tab);
        return { ...tab };
      },
      async get(id) {
        const tab = openTabs.get(id);
        if (!tab) throw new Error("tab-not-found");
        return { ...tab };
      },
      async update(id, patch) {
        calls.tabsUpdate.push({ id, patch });
        const tab = openTabs.get(id);
        if (!tab) throw new Error("tab-not-found");
        Object.assign(tab, patch);
        return { ...tab };
      },
      async remove(id) {
        calls.tabsRemove.push(id);
        openTabs.delete(id);
      },
      async query(queryInfo = {}) {
        const list = Array.from(openTabs.values());
        if (queryInfo.active && queryInfo.currentWindow) {
          return [list.find((t) => t.windowId === 1 && t.active) || list[0]].filter(Boolean);
        }
        if (queryInfo.url) {
          return list.filter((t) => String(t.url || "").includes("youtube.com"));
        }
        return list;
      },
      async executeScript(tabId, details) {
        calls.executeScript.push({ tabId, details });
      },
      async sendMessage(tabId, message) {
        calls.sendMessageToTab.push({ tabId, message });
        if (options.onTabMessage) {
          return options.onTabMessage(tabId, message, context);
        }
        return { ok: true };
      },
      onCreated: { addListener() {} },
      onUpdated: {
        addListener(fn) { tabOnUpdatedListeners.add(fn); },
        removeListener(fn) { tabOnUpdatedListeners.delete(fn); }
      },
      onRemoved: {
        addListener(fn) { tabOnRemovedListeners.add(fn); },
        removeListener(fn) { tabOnRemovedListeners.delete(fn); }
      }
    },
    runtime: {
      async sendMessage() {},
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) { runtimeOnMessageListeners.add(fn); }
      }
    }
  };

  const context = {
    browser,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    WeakSet,
    WeakMap,
    JSON,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console
  };

  vm.createContext(context);
  for (const file of ["src/utils/extension.js", "src/utils/youtube.js", "src/delay.js", "src/background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }

  return { context, storageData, calls, openWindows, openTabs };
}

test("tab-mode worker closes only the tab and never closes the browser window", async () => {
  const { context, storageData, calls, openWindows } = createMockBackground({
    initialStorage: {
      workerMode: "tab",
      queuePaused: false
    },
    onTabMessage(tabId, message, ctx) {
      if (message.type === "start-watch-simulation") {
        setTimeout(() => {
          ctx.handleRuntimeMessage({
            type: "worker-result",
            itemId: message.itemId,
            result: { ok: true, title: "Tab Mode Video - YouTube", playbackSeconds: 5, seekTime: 10, duration: 40 }
          });
        }, 10);
      }
      return { ok: true };
    }
  });

  await context.startBackgroundWork();
  const enq = await context.handleRuntimeMessage({
    type: "enqueue-video-url",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Initial"
  });
  assert.equal(enq.ok, true);

  // Wait for processQueue loop to finish
  for (let i = 0; i < 40; i += 1) {
    if (!context.queueProcessing && storageData.watchQueue?.[0]?.status === "completed") break;
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(calls.windowsRemove.length, 0, "tab mode must NEVER call windows.remove");
  assert.equal(calls.tabsRemove.length, 1, "tab mode must close the worker tab");
  assert.equal(openWindows.has(1), true, "user's main browser window must stay open");
  assert.equal(storageData.workerWindowBounds, undefined, "tab mode must not overwrite workerWindowBounds");
  assert.equal(storageData.watchQueue[0].title, "Tab Mode Video");
});

test("completed-playback status does not discard title and timing from worker-result", async () => {
  const { context, storageData } = createMockBackground({
    initialStorage: { workerMode: "window" },
    onTabMessage(tabId, message, ctx) {
      if (message.type === "start-watch-simulation") {
        setTimeout(() => {
          ctx.handleRuntimeMessage({
            type: "worker-status",
            itemId: message.itemId,
            status: "completed-playback",
            elapsedMs: 5100
          });
        }, 5);
        setTimeout(() => {
          ctx.handleRuntimeMessage({
            type: "worker-result",
            itemId: message.itemId,
            result: {
              ok: true,
              title: "Actual Video Title - YouTube",
              playbackSeconds: 5,
              seekTime: 90,
              duration: 120,
              playbackMode: "foreground-assisted"
            }
          });
        }, 30);
      }
      return { ok: true };
    }
  });

  await context.startBackgroundWork();
  await context.handleRuntimeMessage({
    type: "enqueue-video-url",
    url: "https://www.youtube.com/watch?v=abcDEF_1234",
    title: ""
  });

  for (let i = 0; i < 40; i += 1) {
    if (storageData.watchQueue?.[0]?.status === "completed") break;
    await new Promise((r) => setTimeout(r, 20));
  }

  const item = storageData.watchQueue[0];
  assert.equal(item.status, "completed");
  assert.equal(item.title, "Actual Video Title");
  assert.equal(item.seekTime, 90);
  assert.equal(item.duration, 120);
  assert.equal(item.playbackSeconds, 5);
});

test("concurrent processQueue calls run only one worker at a time", async () => {
  let concurrentRuns = 0;
  let maxConcurrentRuns = 0;

  const { context, storageData } = createMockBackground({
    initialStorage: { workerMode: "tab", queuePaused: true },
    onTabMessage(tabId, message, ctx) {
      if (message.type === "start-watch-simulation") {
        concurrentRuns += 1;
        maxConcurrentRuns = Math.max(maxConcurrentRuns, concurrentRuns);
        setTimeout(() => {
          concurrentRuns -= 1;
          ctx.handleRuntimeMessage({
            type: "worker-result",
            itemId: message.itemId,
            result: { ok: true, title: "Done" }
          });
        }, 25);
      }
      return { ok: true };
    }
  });

  await context.startBackgroundWork();
  await context.handleRuntimeMessage({ type: "enqueue-video-url", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "A" });
  await context.handleRuntimeMessage({ type: "enqueue-video-url", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "B" });

  await context.updateSettings({ queuePaused: false });
  await Promise.all([
    context.processQueue(),
    context.processQueue(),
    context.processQueue()
  ]);

  assert.equal(maxConcurrentRuns, 1);
  assert.equal(storageData.watchQueue.filter((i) => i.status === "completed").length, 2);
});

test("handleMenuClick does not copy host tab title when queueing a link URL", async () => {
  const { context, storageData } = createMockBackground({
    initialStorage: { queuePaused: true }
  });

  await context.startBackgroundWork();
  await context.handleMenuClick(
    { linkUrl: "https://www.youtube.com/watch?v=LinkVideo11" },
    { url: "https://www.youtube.com/feed/subscriptions", title: "Subscriptions - YouTube" }
  );

  assert.equal(storageData.watchQueue.length, 1);
  assert.equal(storageData.watchQueue[0].videoId, "LinkVideo11");
  assert.equal(storageData.watchQueue[0].title, "");
});

test("clearQueue and removeQueueItem do not resurrect items when aborting an active worker", async () => {
  const { context, storageData } = createMockBackground({
    initialStorage: { workerMode: "tab", queuePaused: false },
    onTabMessage() {
      // Never resolves on its own; stays running until aborted.
      return { ok: true };
    }
  });

  await context.startBackgroundWork();
  const first = await context.handleRuntimeMessage({
    type: "enqueue-video-url",
    url: "https://www.youtube.com/watch?v=ccccccccccc",
    title: "C"
  });
  const p = context.processQueue();

  // Wait until item is running with activeWorker
  for (let i = 0; i < 30; i += 1) {
    if (storageData.watchQueue?.[0]?.status === "running") break;
    await new Promise((r) => setTimeout(r, 10));
  }

  await context.removeQueueItem(first.item.id);
  await p;
  assert.equal(storageData.watchQueue.length, 0);

  // Now test clearQueue on a running item
  await context.handleRuntimeMessage({
    type: "enqueue-video-url",
    url: "https://www.youtube.com/watch?v=ddddddddddd",
    title: "D"
  });
  const p2 = context.processQueue();
  for (let i = 0; i < 30; i += 1) {
    if (storageData.watchQueue?.[0]?.status === "running") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await context.clearQueue();
  await p2;
  assert.equal(storageData.watchQueue.length, 0);
});

test("trimSavedQueue keeps pending/running items and trims oldest completed/failed items", async () => {
  const { context } = createMockBackground({
    initialStorage: { maxSavedQueueItems: 2, queuePaused: true }
  });
  await context.startBackgroundWork();

  const trimmed = context.trimSavedQueue([
    { id: "1", status: "completed", completedAt: "2026-01-01T00:00:00Z" },
    { id: "2", status: "failed", completedAt: "2026-01-02T00:00:00Z" },
    { id: "3", status: "pending", createdAt: "2026-01-03T00:00:00Z" },
    { id: "4", status: "completed", completedAt: "2026-01-04T00:00:00Z" }
  ]);

  assert.deepEqual(trimmed.map((item) => item.id), ["3", "4"]);
});
