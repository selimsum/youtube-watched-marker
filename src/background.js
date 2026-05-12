"use strict";

const PAGE_MENU_ID = "mark-youtube-page-watched";
const LINK_MENU_ID = "mark-youtube-link-watched";
const MENU_IDS = [PAGE_MENU_ID, LINK_MENU_ID];
const STORAGE_KEY = "watchQueue";
const WORKER_MODE_KEY = "workerMode";
const WORKER_WINDOW_BOUNDS_KEY = "workerWindowBounds";
const PLAYBACK_SECONDS_KEY = "playbackSeconds";
const SEEK_FROM_END_SECONDS_KEY = "seekFromEndSeconds";
const LOW_QUALITY_ENABLED_KEY = "lowQualityEnabled";
const QUEUE_PAUSED_KEY = "queuePaused";
const MAX_QUEUE_SIZE_KEY = "maxQueueSize";
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const DEFAULT_PLAYBACK_SECONDS = 5;
const DEFAULT_SEEK_FROM_END_SECONDS = 30;
const DEFAULT_LOW_QUALITY_ENABLED = true;
const DEFAULT_QUEUE_PAUSED = false;
const DEFAULT_MAX_QUEUE_SIZE = 20;
const WORKER_TIMEOUT_MS = 90000;
const MAX_DEBUG_EVENTS = 80;
const DEFAULT_WORKER_WINDOW_BOUNDS = {
  left: 1920,
  top: 0,
  width: 1280,
  height: 720
};
const DEFAULT_WORKER_MODE = "window";

let activeWorker = null;

function getExtensionApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }

  return chrome;
}

const extensionApi = getExtensionApi();

function normalizeUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value);
  } catch (_error) {
    return null;
  }
}

function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  );
}

function cleanVideoId(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  return VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function extractVideoIdFromUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);

  if (!url || !isYouTubeHost(url.hostname)) {
    return null;
  }

  if (url.hostname.toLowerCase() === "youtu.be") {
    return cleanVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }

  const watchId = cleanVideoId(url.searchParams.get("v"));
  if (watchId) {
    return watchId;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const firstPart = parts[0] ? parts[0].toLowerCase() : "";

  if (["shorts", "embed", "live"].includes(firstPart)) {
    return cleanVideoId(parts[1]);
  }

  return null;
}

function getCandidateUrls(info, tab) {
  return [
    info.linkUrl,
    info.srcUrl,
    info.frameUrl,
    info.pageUrl,
    tab && tab.url
  ].filter(Boolean);
}

function createQueueItem(videoId, sourceUrl, title) {
  return {
    id: `${videoId}:${Date.now()}`,
    videoId,
    title: cleanTitle(title),
    sourceUrl,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    debugEvents: []
  };
}

function cleanTitle(title) {
  if (!title || typeof title !== "string") {
    return "";
  }

  return title.replace(/\s+/g, " ").replace(/ - YouTube$/, "").trim();
}

async function getQueue() {
  const result = await extensionApi.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function getSettings() {
  const result = await extensionApi.storage.local.get([
    WORKER_MODE_KEY,
    WORKER_WINDOW_BOUNDS_KEY,
    PLAYBACK_SECONDS_KEY,
    SEEK_FROM_END_SECONDS_KEY,
    LOW_QUALITY_ENABLED_KEY,
    QUEUE_PAUSED_KEY,
    MAX_QUEUE_SIZE_KEY
  ]);

  return {
    workerMode: result[WORKER_MODE_KEY] || DEFAULT_WORKER_MODE,
    workerWindowBounds: result[WORKER_WINDOW_BOUNDS_KEY] || DEFAULT_WORKER_WINDOW_BOUNDS,
    playbackSeconds: normalizeSettingNumber(
      result[PLAYBACK_SECONDS_KEY],
      DEFAULT_PLAYBACK_SECONDS,
      1,
      30
    ),
    seekFromEndSeconds: normalizeSettingNumber(
      result[SEEK_FROM_END_SECONDS_KEY],
      DEFAULT_SEEK_FROM_END_SECONDS,
      5,
      120
    ),
    lowQualityEnabled: typeof result[LOW_QUALITY_ENABLED_KEY] === "boolean"
      ? result[LOW_QUALITY_ENABLED_KEY]
      : DEFAULT_LOW_QUALITY_ENABLED,
    queuePaused: typeof result[QUEUE_PAUSED_KEY] === "boolean"
      ? result[QUEUE_PAUSED_KEY]
      : DEFAULT_QUEUE_PAUSED,
    maxQueueSize: normalizeSettingNumber(
      result[MAX_QUEUE_SIZE_KEY],
      DEFAULT_MAX_QUEUE_SIZE,
      1,
      100
    )
  };
}

async function setWorkerMode(workerMode) {
  const nextMode = workerMode === "tab" ? "tab" : "window";
  await extensionApi.storage.local.set({ [WORKER_MODE_KEY]: nextMode });
  return nextMode;
}

function normalizeSettingNumber(value, fallback, minimum, maximum) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(numberValue)));
}

async function updateSettings(patch) {
  const nextValues = {};

  if (Object.prototype.hasOwnProperty.call(patch, "workerMode")) {
    nextValues[WORKER_MODE_KEY] = patch.workerMode === "tab" ? "tab" : "window";
  }

  if (Object.prototype.hasOwnProperty.call(patch, "playbackSeconds")) {
    nextValues[PLAYBACK_SECONDS_KEY] = normalizeSettingNumber(
      patch.playbackSeconds,
      DEFAULT_PLAYBACK_SECONDS,
      1,
      30
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "seekFromEndSeconds")) {
    nextValues[SEEK_FROM_END_SECONDS_KEY] = normalizeSettingNumber(
      patch.seekFromEndSeconds,
      DEFAULT_SEEK_FROM_END_SECONDS,
      5,
      120
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "lowQualityEnabled")) {
    nextValues[LOW_QUALITY_ENABLED_KEY] = Boolean(patch.lowQualityEnabled);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "queuePaused")) {
    nextValues[QUEUE_PAUSED_KEY] = Boolean(patch.queuePaused);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "maxQueueSize")) {
    nextValues[MAX_QUEUE_SIZE_KEY] = normalizeSettingNumber(
      patch.maxQueueSize,
      DEFAULT_MAX_QUEUE_SIZE,
      1,
      100
    );
  }

  if (Object.keys(nextValues).length) {
    await extensionApi.storage.local.set(nextValues);
  }

  return getSettings();
}

async function resetWorkerWindowBounds() {
  await extensionApi.storage.local.remove(WORKER_WINDOW_BOUNDS_KEY);
}

async function setQueue(queue) {
  await extensionApi.storage.local.set({ [STORAGE_KEY]: queue });
}

async function enqueueVideo(videoId, sourceUrl, title) {
  const queue = await getQueue();
  const existingActive = queue.find(
    (item) => (
      item.videoId === videoId &&
      ["pending", "running"].includes(item.status)
    )
  );

  if (existingActive) {
    return {
      item: existingActive,
      ok: true,
      created: false
    };
  }

  const settings = await getSettings();
  const activeCount = getActiveQueueCount(queue);

  if (activeCount >= settings.maxQueueSize) {
    return {
      ok: false,
      error: "queue-limit-reached",
      maxQueueSize: settings.maxQueueSize
    };
  }

  const item = createQueueItem(videoId, sourceUrl, title);
  queue.unshift(item);
  await setQueue(queue);

  return {
    item,
    ok: true,
    created: true
  };
}

function getActiveQueueCount(queue) {
  return queue.filter((item) => ["pending", "running"].includes(item.status)).length;
}

async function clearQueue() {
  if (activeWorker) {
    await closeWorkerQuietly(activeWorker);
    activeWorker = null;
  }

  await setQueue([]);
}

async function removeQueueItem(itemId) {
  const queue = await getQueue();
  const item = queue.find((entry) => entry.id === itemId);

  if (item && activeWorker && activeWorker.itemId === item.id) {
    await closeWorkerQuietly(activeWorker);
    activeWorker = null;
  }

  await setQueue(queue.filter((entry) => entry.id !== itemId));
}

async function retryQueueItem(itemId) {
  const queue = await getQueue();
  const settings = await getSettings();
  const activeCount = getActiveQueueCount(queue);
  let retriedItem = null;
  const updatedAt = new Date().toISOString();
  const nextQueue = queue.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    if (!["pending", "running"].includes(item.status) && activeCount >= settings.maxQueueSize) {
      retriedItem = item;
      return item;
    }

    retriedItem = {
      ...item,
      status: "pending",
      error: null,
      workerStatus: null,
      playbackMode: null,
      debugSummary: null,
      debugEvents: [],
      startedAt: null,
      completedAt: null,
      updatedAt
    };

    return retriedItem;
  });

  await setQueue(nextQueue);
  processQueue().catch(console.error);
  return retriedItem;
}

async function retryQueueByStatus(status) {
  const queue = await getQueue();
  const settings = await getSettings();
  let availableSlots = Math.max(0, settings.maxQueueSize - getActiveQueueCount(queue));
  const updatedAt = new Date().toISOString();
  let retriedCount = 0;
  const nextQueue = queue.map((item) => {
    if (item.status !== status || availableSlots <= 0) {
      return item;
    }

    retriedCount += 1;
    availableSlots -= 1;
    return {
      ...item,
      status: "pending",
      error: null,
      workerStatus: null,
      playbackMode: null,
      debugSummary: null,
      debugEvents: [],
      startedAt: null,
      completedAt: null,
      updatedAt
    };
  });

  await setQueue(nextQueue);
  processQueue().catch(console.error);
  return retriedCount;
}

async function clearQueueByStatus(status) {
  const queue = await getQueue();
  const nextQueue = queue.filter((item) => item.status !== status);
  await setQueue(nextQueue);
  return nextQueue;
}

async function stopCurrentWorker() {
  if (!activeWorker) {
    return false;
  }

  const itemId = activeWorker.itemId;
  await closeWorkerQuietly(activeWorker);
  activeWorker = null;
  await updateQueueItem(itemId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: "stopped-by-user"
  });
  return true;
}

async function updateQueueItem(itemId, patch) {
  const queue = await getQueue();
  const updatedAt = new Date().toISOString();
  const nextQueue = queue.map((item) => (
    item.id === itemId
      ? { ...item, ...patch, updatedAt }
      : item
  ));
  await setQueue(nextQueue);
  return nextQueue.find((item) => item.id === itemId);
}

function buildWatchUrl(videoId) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  url.searchParams.set("ytwm_worker", "1");
  return url.toString();
}

async function refreshBadge() {
  const queue = await getQueue();
  const settings = await getSettings();
  const pendingCount = queue.filter((item) => item.status === "pending").length;
  const runningCount = queue.filter((item) => item.status === "running").length;

  extensionApi.browserAction.setBadgeText({
    text: settings.queuePaused && (pendingCount || runningCount)
      ? "P"
      : (pendingCount || runningCount ? String(pendingCount + runningCount) : "")
  });

  extensionApi.browserAction.setBadgeBackgroundColor({
    color: settings.queuePaused ? "#64748b" : "#c2410c"
  });
}

function notifyPopup(message) {
  extensionApi.runtime.sendMessage(message).catch(() => {
    // No popup is listening. That is expected most of the time.
  });
}

async function notifyQueueUpdated(extra) {
  await refreshBadge();
  notifyPopup({
    type: "queue-updated",
    ...(extra || {})
  });
}

async function handleMenuClick(info, tab) {
  for (const candidateUrl of getCandidateUrls(info, tab)) {
    const videoId = extractVideoIdFromUrl(candidateUrl);

    if (videoId) {
      const result = await enqueueVideo(videoId, candidateUrl, tab && tab.title);

      if (!result.ok) {
        return;
      }

      await notifyQueueUpdated({
        item: result.item,
        created: result.created
      });
      processQueue().catch(console.error);
      return;
    }
  }
}

async function handleRuntimeMessage(message) {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "enqueue-video-url") {
    const videoId = extractVideoIdFromUrl(message.url);

    if (!videoId) {
      return {
        ok: false,
        error: "unsupported-url"
      };
    }

    const result = await enqueueVideo(videoId, message.url, message.title);

    if (!result.ok) {
      return result;
    }

    await notifyQueueUpdated({
      item: result.item,
      created: result.created
    });
    processQueue().catch(console.error);

    return {
      ok: true,
      item: result.item,
      created: result.created
    };
  }

  if (message.type === "get-queue") {
    return {
      queue: await getQueue()
    };
  }

  if (message.type === "get-settings") {
    return {
      settings: await getSettings()
    };
  }

  if (message.type === "set-worker-mode") {
    return {
      workerMode: await setWorkerMode(message.workerMode),
      settings: await getSettings()
    };
  }

  if (message.type === "update-settings") {
    const settings = await updateSettings(message.settings || {});

    if (!settings.queuePaused) {
      processQueue().catch(console.error);
    }

    return {
      settings
    };
  }

  if (message.type === "reset-worker-window-bounds") {
    await resetWorkerWindowBounds();
    return {
      settings: await getSettings()
    };
  }

  if (message.type === "clear-queue") {
    await clearQueue();
    await notifyQueueUpdated();
    return {
      queue: []
    };
  }

  if (message.type === "clear-completed") {
    const queue = await clearQueueByStatus("completed");
    await notifyQueueUpdated();
    return {
      queue
    };
  }

  if (message.type === "clear-failed") {
    const queue = await clearQueueByStatus("failed");
    await notifyQueueUpdated();
    return {
      queue
    };
  }

  if (message.type === "retry-failed") {
    await retryQueueByStatus("failed");
    await notifyQueueUpdated();
    return {
      queue: await getQueue()
    };
  }

  if (message.type === "stop-worker") {
    const stopped = await stopCurrentWorker();
    await notifyQueueUpdated();
    return {
      ok: true,
      stopped,
      queue: await getQueue()
    };
  }

  if (message.type === "get-debug-export") {
    return {
      exportedAt: new Date().toISOString(),
      settings: await getSettings(),
      queue: await getQueue()
    };
  }

  if (message.type === "remove-queue-item") {
    await removeQueueItem(message.itemId);
    await notifyQueueUpdated();
    return {
      ok: true,
      queue: await getQueue()
    };
  }

  if (message.type === "retry-queue-item") {
    const item = await retryQueueItem(message.itemId);
    await notifyQueueUpdated({ item });
    return {
      ok: true,
      item,
      queue: await getQueue()
    };
  }

  if (message.type === "focus-worker-tab") {
    await focusWorkerTab();
    return {
      ok: true
    };
  }

  if (message.type === "release-worker-tab") {
    await releaseWorkerTab();
    return {
      ok: true
    };
  }

  if (message.type === "worker-result") {
    handleWorkerResult(message);
    return {
      ok: true
    };
  }

  if (message.type === "worker-status") {
    handleWorkerStatus(message);
    return {
      ok: true
    };
  }

  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(
        typeof errorMessage === "function" ? errorMessage() : errorMessage
      ));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function closeTabQuietly(tabId) {
  try {
    await extensionApi.tabs.remove(tabId);
  } catch (_error) {
    // The tab may already be gone.
  }
}

async function closeWorkerQuietly(worker) {
  if (!worker) {
    return;
  }

  if (worker.windowId) {
    await rememberWorkerWindowBounds(worker.windowId);

    try {
      await extensionApi.windows.remove(worker.windowId);
      return;
    } catch (_error) {
      // Fall back to tab removal below when the window is already gone.
    }
  }

  if (worker.tabId) {
    await closeTabQuietly(worker.tabId);
  }
}

async function getWorkerWindowBounds() {
  const result = await extensionApi.storage.local.get(WORKER_WINDOW_BOUNDS_KEY);
  const bounds = result[WORKER_WINDOW_BOUNDS_KEY] || {};

  return {
    left: Number.isFinite(bounds.left) ? bounds.left : DEFAULT_WORKER_WINDOW_BOUNDS.left,
    top: Number.isFinite(bounds.top) ? bounds.top : DEFAULT_WORKER_WINDOW_BOUNDS.top,
    width: normalizeWorkerWindowSize(bounds.width, DEFAULT_WORKER_WINDOW_BOUNDS.width),
    height: normalizeWorkerWindowSize(bounds.height, DEFAULT_WORKER_WINDOW_BOUNDS.height)
  };
}

function normalizeWorkerWindowSize(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(value, fallback);
}

async function rememberWorkerWindowBounds(windowId) {
  try {
    const workerWindow = await extensionApi.windows.get(windowId);
    await extensionApi.storage.local.set({
      [WORKER_WINDOW_BOUNDS_KEY]: {
        left: workerWindow.left,
        top: workerWindow.top,
        width: DEFAULT_WORKER_WINDOW_BOUNDS.width,
        height: DEFAULT_WORKER_WINDOW_BOUNDS.height
      }
    });
  } catch (_error) {
    // The worker window may already be closed.
  }
}

async function createWorkerWindow(url) {
  const bounds = await getWorkerWindowBounds();
  const workerWindow = await extensionApi.windows.create({
    url,
    type: "popup",
    focused: true,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });
  await forceWorkerWindowBounds(workerWindow.id, bounds.left, bounds.top);
  setTimeout(() => {
    forceWorkerWindowBounds(workerWindow.id, bounds.left, bounds.top).catch(() => {});
  }, 500);

  return {
    windowId: workerWindow.id,
    tab: workerWindow.tabs && workerWindow.tabs[0]
  };
}

async function forceWorkerWindowBounds(windowId, left, top) {
  await extensionApi.windows.update(windowId, {
    state: "normal"
  }).catch(() => {});

  await extensionApi.windows.update(windowId, {
    left,
    top,
    width: DEFAULT_WORKER_WINDOW_BOUNDS.width,
    height: DEFAULT_WORKER_WINDOW_BOUNDS.height,
    focused: true
  });
}

async function waitForTabComplete(tabId, timeoutMs) {
  const initialTab = await extensionApi.tabs.get(tabId);

  if (initialTab.status === "complete") {
    return;
  }

  await withTimeout(new Promise((resolve, reject) => {
    function cleanup() {
      extensionApi.tabs.onUpdated.removeListener(onUpdated);
      extensionApi.tabs.onRemoved.removeListener(onRemoved);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error("worker-tab-closed"));
      }
    }

    extensionApi.tabs.onUpdated.addListener(onUpdated);
    extensionApi.tabs.onRemoved.addListener(onRemoved);
  }), timeoutMs, "tab-load-timeout");
}

async function injectPlayerWorker(tabId) {
  await extensionApi.tabs.executeScript(tabId, {
    file: "src/player-worker.js",
    runAt: "document_idle"
  });
}

async function sendWorkerMessageWithRetry(tabId, message) {
  let lastError = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await extensionApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  }

  throw lastError || new Error("worker-not-ready");
}

function waitForWorkerResult(itemId, timeoutMs) {
  return withTimeout(new Promise((resolve, reject) => {
    if (!activeWorker || activeWorker.itemId !== itemId) {
      reject(new Error("worker-not-active"));
      return;
    }

    activeWorker.resolve = resolve;
    activeWorker.reject = reject;
  }), timeoutMs, getWorkerTimeoutMessage);
}

function getWorkerTimeoutMessage() {
  if (activeWorker && activeWorker.lastStatus) {
    return `worker-timeout-after-${activeWorker.lastStatus}`;
  }

  return "worker-timeout";
}

function handleWorkerResult(message) {
  if (!activeWorker || activeWorker.itemId !== message.itemId) {
    return;
  }

  const resolve = activeWorker.resolve;

  if (resolve) {
    resolve(message.result || {
      ok: false,
      error: "missing-worker-result"
    });
  }
}

function handleWorkerStatus(message) {
  if (!activeWorker || activeWorker.itemId !== message.itemId) {
    return;
  }

  activeWorker.lastStatus = message.status;
  const playbackMode = getStatusPlaybackMode(message.status);
  updateQueueItemWithDebug(message.itemId, {
    workerStatus: message.status,
    ...(playbackMode ? { playbackMode } : {})
  }, {
    event: message.status,
    elapsedMs: message.elapsedMs
  }).then((item) => notifyQueueUpdated({ item })).catch(console.error);
}

async function updateQueueItemWithDebug(itemId, patch, event) {
  const queue = await getQueue();
  const updatedAt = new Date().toISOString();
  let updatedItem = null;
  const nextQueue = queue.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    const debugEvents = Array.isArray(item.debugEvents) ? item.debugEvents : [];
    const nextDebugEvents = event && event.event
      ? [...debugEvents, { at: updatedAt, ...event }].slice(-MAX_DEBUG_EVENTS)
      : debugEvents;

    updatedItem = {
      ...item,
      ...patch,
      debugEvents: nextDebugEvents,
      updatedAt
    };

    return updatedItem;
  });

  await setQueue(nextQueue);
  return updatedItem;
}

function getPlaybackModeForStatus(status) {
  if (status === "hidden-playback-confirmed") {
    return "hidden";
  }

  if (
    status === "foreground-assist-started" ||
    status === "foreground-assist-releasing" ||
    status === "foreground-playback-confirmed"
  ) {
    return "foreground-assisted";
  }

  return undefined;
}

function getPlaybackModeFromResult(result) {
  if (result && result.playbackMode) {
    return result.playbackMode;
  }

  if (activeWorker && activeWorker.playbackMode) {
    return activeWorker.playbackMode;
  }

  return "unknown";
}

function getDebugSummary(result) {
  const mode = getPlaybackModeFromResult(result);

  if (mode === "hidden") {
    return "Hidden playback worked";
  }

  if (mode === "foreground-assisted") {
    return "Worker window playback was used";
  }

  return "Playback mode unknown";
}

function handlePlaybackModeChange(mode) {
  if (!activeWorker || !mode) {
    return;
  }

  activeWorker.playbackMode = mode;
}

function getStatusPlaybackMode(status) {
  const mode = getPlaybackModeForStatus(status);

  if (mode) {
    handlePlaybackModeChange(mode);
  }

  return mode;
}

async function getActiveTab() {
  const tabs = await extensionApi.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0] || null;
}

async function focusWorkerTab() {
  if (!activeWorker || !activeWorker.tabId) {
    return;
  }

  if (!activeWorker.previousTabId) {
    const previousTab = await getActiveTab();
    activeWorker.previousTabId = previousTab && previousTab.id !== activeWorker.tabId
      ? previousTab.id
      : null;
    activeWorker.previousWindowId = previousTab && previousTab.windowId !== activeWorker.windowId
      ? previousTab.windowId
      : null;
  }

  if (activeWorker.windowId) {
    await extensionApi.windows.update(activeWorker.windowId, {
      focused: true
    }).catch(() => {});
  }

  await extensionApi.tabs.update(activeWorker.tabId, {
    active: true
  });
}

async function releaseWorkerTab() {
  if (!activeWorker || (!activeWorker.previousTabId && !activeWorker.previousWindowId)) {
    return;
  }

  const previousTabId = activeWorker.previousTabId;
  const previousWindowId = activeWorker.previousWindowId;
  activeWorker.previousTabId = null;
  activeWorker.previousWindowId = null;

  if (previousWindowId) {
    await extensionApi.windows.update(previousWindowId, {
      focused: true
    }).catch(() => {});
  }

  if (previousTabId !== activeWorker.tabId) {
    await extensionApi.tabs.update(previousTabId, {
      active: true
    }).catch(() => {});
  }
}

async function runQueueItem(item) {
  let tab = null;
  let workerWindowId = null;

  try {
    const runningItem = await updateQueueItem(item.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      error: null
    });
    await notifyQueueUpdated({ item: runningItem });

    const previousTab = await getActiveTab();
    const settings = await getSettings();

    if (settings.workerMode === "window") {
      const workerWindow = await createWorkerWindow(buildWatchUrl(item.videoId));
      tab = workerWindow.tab;
      workerWindowId = workerWindow.windowId;
    } else {
      tab = await extensionApi.tabs.create({
        url: buildWatchUrl(item.videoId),
        active: false
      });
    }

    if (!tab || !tab.id) {
      throw new Error("worker-tab-not-found");
    }

    activeWorker = {
      itemId: item.id,
      tabId: tab.id,
      windowId: workerWindowId,
      lastStatus: settings.workerMode === "window" ? "window-created" : "tab-created",
      previousTabId: previousTab && previousTab.id !== tab.id ? previousTab.id : null,
      previousWindowId: previousTab && previousTab.windowId !== workerWindowId ? previousTab.windowId : null
    };

    await extensionApi.tabs.update(tab.id, {
      muted: true
    });

    await waitForTabComplete(tab.id, 45000);
    await injectPlayerWorker(tab.id);

    const startResponse = await sendWorkerMessageWithRetry(tab.id, {
      type: "start-watch-simulation",
      itemId: item.id,
      playbackSeconds: settings.playbackSeconds,
      seekFromEndSeconds: settings.seekFromEndSeconds,
      lowQualityEnabled: settings.lowQualityEnabled
    });

    if (startResponse && startResponse.ok === false) {
      throw new Error((startResponse && startResponse.error) || "worker-start-failed");
    }

    const result = await waitForWorkerResult(item.id, WORKER_TIMEOUT_MS);

    const completedItem = await updateQueueItem(item.id, {
      status: result && result.ok ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      playbackSeconds: result && result.playbackSeconds,
      seekFromEndSeconds: settings.seekFromEndSeconds,
      lowQualityEnabled: settings.lowQualityEnabled,
      seekTime: result && result.seekTime,
      duration: result && result.duration,
      title: cleanTitle(result && result.title) || item.title,
      playbackMode: getPlaybackModeFromResult(result),
      debugSummary: getDebugSummary(result),
      error: result && result.ok ? null : ((result && result.error) || "worker-failed")
    });
    await notifyQueueUpdated({ item: completedItem });
  } catch (error) {
    const failedItem = await updateQueueItem(item.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      playbackMode: activeWorker && activeWorker.playbackMode ? activeWorker.playbackMode : "unknown",
      debugSummary: activeWorker && activeWorker.playbackMode === "hidden"
        ? "Hidden playback worked before failure"
        : "Worker window playback failed",
      error: error && error.message ? error.message : String(error)
    });
    await notifyQueueUpdated({ item: failedItem });
  } finally {
    if (activeWorker) {
      await closeWorkerQuietly(activeWorker);
    } else if (workerWindowId) {
      await closeWorkerQuietly({ windowId: workerWindowId, tabId: tab && tab.id });
    } else if (tab && tab.id) {
      await closeTabQuietly(tab.id);
    }

    activeWorker = null;
  }
}

async function resetStaleRunningItems() {
  const queue = await getQueue();
  let changed = false;
  const nextQueue = queue.map((item) => {
    if (item.status !== "running") {
      return item;
    }

    changed = true;
    return {
      ...item,
      status: "pending",
      error: "reset-after-extension-reload",
      updatedAt: new Date().toISOString()
    };
  });

  if (changed) {
    await setQueue(nextQueue);
    await notifyQueueUpdated();
  }
}

async function processQueue() {
  if (activeWorker) {
    return;
  }

  const settings = await getSettings();

  if (settings.queuePaused) {
    await refreshBadge();
    return;
  }

  const queue = await getQueue();
  const item = queue.find((entry) => entry.status === "pending");

  if (!item) {
    await refreshBadge();
    return;
  }

  await runQueueItem(item);
  processQueue().catch(console.error);
}

function registerContextMenu() {
  Promise.all(
    MENU_IDS.map((menuId) => (
      extensionApi.contextMenus.remove(menuId).catch(() => {
        // The menu will not exist on first install or after some reloads.
      })
    ))
  ).finally(() => {
    extensionApi.contextMenus.create({
      id: PAGE_MENU_ID,
      title: "Mark as watched",
      contexts: ["page", "video"],
      documentUrlPatterns: [
        "*://www.youtube.com/*",
        "*://m.youtube.com/*",
        "*://youtu.be/*"
      ]
    });

    extensionApi.contextMenus.create({
      id: LINK_MENU_ID,
      title: "Mark as watched",
      contexts: ["link"],
      targetUrlPatterns: [
        "*://www.youtube.com/*",
        "*://m.youtube.com/*",
        "*://youtu.be/*"
      ]
    });
  });
}

extensionApi.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  resetStaleRunningItems().then(() => processQueue()).catch(console.error);
});

extensionApi.runtime.onStartup.addListener(() => {
  registerContextMenu();
  resetStaleRunningItems().then(() => processQueue()).catch(console.error);
});

extensionApi.contextMenus.onClicked.addListener((info, tab) => {
  if (MENU_IDS.includes(info.menuItemId)) {
    handleMenuClick(info, tab).catch(console.error);
  }
});

extensionApi.runtime.onMessage.addListener((message) => {
  return handleRuntimeMessage(message);
});

registerContextMenu();
resetStaleRunningItems()
  .then(() => processQueue())
  .catch(console.error);

if (typeof module !== "undefined") {
  module.exports = {
    cleanVideoId,
    extractVideoIdFromUrl
  };
}
