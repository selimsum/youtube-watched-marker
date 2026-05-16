"use strict";

const PAGE_MENU_ID = "mark-youtube-page-watched";
const LINK_MENU_ID = "mark-youtube-link-watched";
const MENU_IDS = [PAGE_MENU_ID, LINK_MENU_ID];
const STORAGE_KEY = "watchQueue";
const WORKER_MODE_KEY = "workerMode";
const WORKER_WINDOW_BOUNDS_KEY = "workerWindowBounds";
const PLAYBACK_SECONDS_KEY = "playbackSeconds";
const SEEK_FROM_END_SECONDS_KEY = "seekFromEndSeconds";
const QUEUE_PAUSED_KEY = "queuePaused";
const MAX_QUEUE_SIZE_KEY = "maxQueueSize";
const WAITING_FOR_DIRECT_OPEN_KEY = "waitingForDirectOpen";
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const DEFAULT_PLAYBACK_SECONDS = 5;
const DEFAULT_SEEK_FROM_END_SECONDS = 30;
const DEFAULT_QUEUE_PAUSED = false;
const DEFAULT_MAX_QUEUE_SIZE = 20;
const MAX_QUEUE_SIZE_LIMIT = 500;
const WORKER_TIMEOUT_MS = 90000;
const WORKER_TIMEOUT_BASE_MS = 35000;
const WORKER_TIMEOUT_BUFFER_MS = 15000;
const MAX_DEBUG_EVENTS = 80;
const DEFAULT_WORKER_WINDOW_BOUNDS = {
  left: 2176,
  top: 144,
  width: 1280,
  height: 720
};
const SECONDARY_TOP_LEFT_WORKER_BOUNDS = {
  left: 1920,
  top: 0,
  width: 1280,
  height: 720
};
const PRIMARY_SCREEN_MAX_LEFT = 1000;
const RIGHT_MONITOR_MAX_LEFT = 2300;
const DEFAULT_WORKER_MODE = "window";

let activeWorker = null;
let retainedWorker = null;

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

function createQueueItem(videoId, sourceUrl, title, extra) {
  return {
    id: `${videoId}:${Date.now()}`,
    videoId,
    title: cleanTitle(title),
    sourceUrl,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    debugEvents: [],
    ...(extra || {})
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
    QUEUE_PAUSED_KEY,
    MAX_QUEUE_SIZE_KEY,
    WAITING_FOR_DIRECT_OPEN_KEY
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
      1,
      120
    ),
    queuePaused: typeof result[QUEUE_PAUSED_KEY] === "boolean"
      ? result[QUEUE_PAUSED_KEY]
      : DEFAULT_QUEUE_PAUSED,
    maxQueueSize: normalizeSettingNumber(
      result[MAX_QUEUE_SIZE_KEY],
      DEFAULT_MAX_QUEUE_SIZE,
      1,
      MAX_QUEUE_SIZE_LIMIT
    ),
    waitingForDirectOpen: typeof result[WAITING_FOR_DIRECT_OPEN_KEY] === "boolean"
      ? result[WAITING_FOR_DIRECT_OPEN_KEY]
      : false
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
      1,
      120
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "queuePaused")) {
    nextValues[QUEUE_PAUSED_KEY] = Boolean(patch.queuePaused);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "maxQueueSize")) {
    nextValues[MAX_QUEUE_SIZE_KEY] = normalizeSettingNumber(
      patch.maxQueueSize,
      DEFAULT_MAX_QUEUE_SIZE,
      1,
      MAX_QUEUE_SIZE_LIMIT
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "waitingForDirectOpen")) {
    nextValues[WAITING_FOR_DIRECT_OPEN_KEY] = Boolean(patch.waitingForDirectOpen);
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

async function enqueueVideo(videoId, sourceUrl, title, extra) {
  const queue = await getQueue();
  const existingActive = queue.find(
    (item) => (
      item.videoId === videoId &&
      ["pending", "running"].includes(item.status)
    )
  );

  if (existingActive) {
    if (extra && extra.openedWorkerUrl) {
      const updatedItem = await updateQueueItem(existingActive.id, {
        openedWorkerUrl: extra.openedWorkerUrl,
        targetWorkerUrl: extra.targetWorkerUrl || null,
        workerStatus: null
      });
      await extensionApi.storage.local.set({
        [WAITING_FOR_DIRECT_OPEN_KEY]: false
      });

      return {
        item: updatedItem || existingActive,
        ok: true,
        created: false
      };
    }

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

  const item = createQueueItem(videoId, sourceUrl, title, extra);
  queue.unshift(item);
  await setQueue(queue);

  if (extra && extra.openedWorkerUrl) {
    await extensionApi.storage.local.set({
      [WAITING_FOR_DIRECT_OPEN_KEY]: false
    });
  }

  return {
    item,
    ok: true,
    created: true
  };
}

async function bulkEnqueueVideos(videos, source, channelUrl) {
  if (!Array.isArray(videos)) {
    return {
      ok: false,
      error: "invalid-videos"
    };
  }

  const queue = await getQueue();
  const settings = await getSettings();
  const activeVideoIds = new Set(queue
    .filter((item) => ["pending", "running"].includes(item.status))
    .map((item) => item.videoId));
  const createdItems = [];
  const seenInputIds = new Set();
  let availableSlots = Math.max(0, settings.maxQueueSize - getActiveQueueCount(queue));
  let duplicate = 0;
  let skipped = 0;
  let errors = 0;

  for (const video of videos) {
    const videoId = extractVideoIdFromUrl(video && video.url);

    if (!videoId) {
      errors += 1;
      continue;
    }

    if (activeVideoIds.has(videoId) || seenInputIds.has(videoId)) {
      duplicate += 1;
      continue;
    }

    if (availableSlots <= 0) {
      skipped += 1;
      continue;
    }

    seenInputIds.add(videoId);
    activeVideoIds.add(videoId);
    availableSlots -= 1;
    createdItems.push(createQueueItem(videoId, video.url, video.title, {
      source: source || "channel-timeframe",
      channelUrl: video.channelUrl || channelUrl || null,
      publishedAt: video.publishedAt || null,
      dateMatchPrecision: video.dateMatchPrecision || null
    }));
  }

  if (createdItems.length) {
    await setQueue([...createdItems, ...queue]);
  }

  return {
    ok: true,
    queued: createdItems.length,
    duplicate,
    skipped,
    errors,
    maxQueueSize: settings.maxQueueSize,
    queue: await getQueue()
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

  if (retainedWorker) {
    await closeWorkerQuietly(retainedWorker);
    retainedWorker = null;
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
      openedWorkerUrl: null,
      targetWorkerUrl: null,
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
      openedWorkerUrl: null,
      targetWorkerUrl: null,
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
  if (!activeWorker && !retainedWorker) {
    return false;
  }

  if (activeWorker) {
    const itemId = activeWorker.itemId;
    await closeWorkerQuietly(activeWorker);
    activeWorker = null;
    await updateQueueItem(itemId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: "stopped-by-user"
    });
  }

  if (retainedWorker) {
    await closeWorkerQuietly(retainedWorker);
    retainedWorker = null;
  }

  return true;
}

async function hasPendingQueueItems() {
  const queue = await getQueue();
  return queue.some((entry) => entry.status === "pending");
}

async function retainWorkerForNextItem(worker) {
  if (!worker || !worker.windowId || !worker.tabId) {
    return false;
  }

  try {
    const tab = await extensionApi.tabs.get(worker.tabId);
    const workerWindow = await extensionApi.windows.get(worker.windowId);
    retainedWorker = {
      windowId: worker.windowId,
      tabId: worker.tabId,
      requestedBounds: worker.requestedBounds || normalizeWorkerBounds({
        left: workerWindow.left,
        top: workerWindow.top,
        width: workerWindow.width,
        height: workerWindow.height
      })
    };
    await extensionApi.tabs.update(tab.id, {
      muted: true
    }).catch(() => {});
    return true;
  } catch (_error) {
    retainedWorker = null;
    return false;
  }
}

async function useRetainedWorkerWindow(url) {
  if (!retainedWorker || !retainedWorker.windowId || !retainedWorker.tabId) {
    return null;
  }

  const worker = retainedWorker;
  retainedWorker = null;

  try {
    const tab = await extensionApi.tabs.update(worker.tabId, {
      url,
      active: true,
      muted: true
    });
    await extensionApi.windows.update(worker.windowId, {
      focused: true
    }).catch(() => {});
    await waitForTabVideoUrl(tab.id, getRequiredVideoIdFromUrl(url), 30000);

    return {
      windowId: worker.windowId,
      tab,
      requestedBounds: worker.requestedBounds,
      reused: true
    };
  } catch (_error) {
    await closeWorkerQuietly(worker);
    return null;
  }
}

async function updateQueueItem(itemId, patch, event = null) {
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

function buildWatchUrl(videoId) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  url.searchParams.set("ytwm_worker", "1");
  url.searchParams.set("mute", "1");
  url.searchParams.set("autoplay", "0");
  return url.toString();
}

function isWorkerWatchUrl(url) {
  const parsedUrl = normalizeUrl(url);

  return Boolean(
    parsedUrl &&
    isYouTubeHost(parsedUrl.hostname) &&
    parsedUrl.searchParams.get("ytwm_worker") === "1"
  );
}

async function muteWorkerTabIfNeeded(tabId, url) {
  if (!tabId || !isWorkerWatchUrl(url)) {
    return;
  }

  await extensionApi.tabs.update(tabId, {
    muted: true
  }).catch(() => {});
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
  await notifyContentQueueState();
  notifyPopup({
    type: "queue-updated",
    ...(extra || {})
  });
}

async function notifyContentQueueState() {
  const queue = await getQueue();
  const settings = await getSettings();
  const state = {
    type: "queue-state",
    activeCount: getActiveQueueCount(queue),
    hasActiveWorker: Boolean(activeWorker || retainedWorker),
    queuePaused: settings.queuePaused,
    waitingForDirectOpen: settings.waitingForDirectOpen
  };
  const tabs = await extensionApi.tabs.query({
    url: [
      "*://www.youtube.com/*",
      "*://m.youtube.com/*"
    ]
  });

  await Promise.all(tabs.map((tab) => (
    extensionApi.tabs.sendMessage(tab.id, state).catch(() => {})
  )));
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

  if (message.type === "enqueue-video-url-with-opened-worker") {
    const videoId = extractVideoIdFromUrl(message.url);

    if (!videoId) {
      return {
        ok: false,
        error: "unsupported-url"
      };
    }

    const expectedWorkerUrl = buildWatchUrl(videoId);
    const result = await enqueueVideo(videoId, message.url, message.title, {
      openedWorkerUrl: message.openedWorkerUrl || message.workerUrl || expectedWorkerUrl,
      targetWorkerUrl: message.workerUrl || expectedWorkerUrl
    });

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

  if (message.type === "bulk-enqueue-video-urls") {
    const result = await bulkEnqueueVideos(
      message.videos,
      message.source,
      message.channelUrl
    );

    if (!result.ok) {
      return result;
    }

    await notifyQueueUpdated();
    processQueue().catch(console.error);
    return result;
  }

  if (message.type === "get-queue") {
    return {
      queue: await getQueue()
    };
  }

  if (message.type === "get-queue-state") {
    const queue = await getQueue();
    const settings = await getSettings();

    return {
      activeCount: getActiveQueueCount(queue),
      hasActiveWorker: Boolean(activeWorker || retainedWorker),
      queuePaused: settings.queuePaused,
      waitingForDirectOpen: settings.waitingForDirectOpen
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
    await notifyContentQueueState();

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

  if (message.type === "save-current-worker-window-bounds") {
    const result = await saveCurrentWorkerWindowBounds();
    return {
      ok: result.ok,
      error: result.error || null,
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

  if (worker.tabId) {
    await stopWorkerPlaybackQuietly(worker.tabId);
  }

  if (worker.windowId) {
    await rememberWorkerWindowBounds(worker);

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

async function stopWorkerPlaybackQuietly(tabId) {
  try {
    await extensionApi.tabs.sendMessage(tabId, {
      type: "stop-watch-simulation"
    });
  } catch (_error) {
    // The worker content script may not be loaded or may already be gone.
  }

  try {
    await extensionApi.tabs.executeScript(tabId, {
      code: "for (const video of document.querySelectorAll('video')) { try { video.pause(); video.currentTime = video.currentTime; } catch (_error) {} }",
      runAt: "document_idle"
    });
  } catch (_error) {
    // The tab may be closing or no longer scriptable.
  }
}

async function getWorkerWindowBounds() {
  const result = await extensionApi.storage.local.get(WORKER_WINDOW_BOUNDS_KEY);
  const bounds = result[WORKER_WINDOW_BOUNDS_KEY] || {};
  const normalizedBounds = normalizeWorkerBounds(bounds);

  if (normalizedBounds.left < PRIMARY_SCREEN_MAX_LEFT) {
    return { ...DEFAULT_WORKER_WINDOW_BOUNDS };
  }

  if (normalizedBounds.left > RIGHT_MONITOR_MAX_LEFT) {
    return {
      ...normalizedBounds,
      left: DEFAULT_WORKER_WINDOW_BOUNDS.left,
      top: DEFAULT_WORKER_WINDOW_BOUNDS.top
    };
  }

  return normalizedBounds;
}

function normalizeWindowPosition(value, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.round(numberValue);
}

function normalizeWorkerWindowSize(value, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(numberValue), 320), fallback);
}

async function rememberWorkerWindowBounds(worker) {
  try {
    const workerWindow = await extensionApi.windows.get(worker.windowId);
    const actualBounds = normalizeWorkerBounds({
      left: workerWindow.left,
      top: workerWindow.top,
      width: workerWindow.width,
      height: workerWindow.height
    });
    const requestedBounds = normalizeWorkerBounds(worker.requestedBounds || {});

    if (shouldIgnorePrimaryFallbackBounds(actualBounds, requestedBounds)) {
      await updateQueueItem(worker.itemId, {}, {
        event: `window-bounds-ignored-primary-fallback-${formatBounds(actualBounds)}`,
        elapsedMs: null
      }).catch(() => {});
      return;
    }

    const safeBounds = getSafeSavedWorkerBounds(actualBounds);
    await extensionApi.storage.local.set({
      [WORKER_WINDOW_BOUNDS_KEY]: safeBounds
    });
    await updateQueueItem(worker.itemId, {}, {
      event: `window-bounds-saved-${formatBounds(safeBounds)}`,
      elapsedMs: null
    }).catch(() => {});
  } catch (_error) {
    // The worker window may already be closed.
  }
}

async function saveCurrentWorkerWindowBounds() {
  const workerWindowId = await findCurrentWorkerWindowId();

  if (!workerWindowId) {
    return {
      ok: false,
      error: "no-worker-window-found"
    };
  }

  const workerWindow = await extensionApi.windows.get(workerWindowId);
  const bounds = normalizeWorkerBounds({
    left: workerWindow.left,
    top: workerWindow.top,
    width: workerWindow.width,
    height: workerWindow.height
  });
  const safeBounds = getSafeSavedWorkerBounds(bounds);

  await extensionApi.storage.local.set({
    [WORKER_WINDOW_BOUNDS_KEY]: safeBounds
  });

  if (activeWorker && activeWorker.itemId) {
    await updateQueueItem(activeWorker.itemId, {}, {
      event: `window-bounds-saved-current-${formatBounds(safeBounds)}`,
      elapsedMs: null
    }).catch(() => {});
  }

  return {
    ok: true,
    bounds: safeBounds
  };
}

async function findCurrentWorkerWindowId() {
  if (activeWorker && activeWorker.windowId) {
    return activeWorker.windowId;
  }

  if (retainedWorker && retainedWorker.windowId) {
    return retainedWorker.windowId;
  }

  const tabs = await extensionApi.tabs.query({
    url: [
      "*://www.youtube.com/watch*ytwm_worker=1*",
      "*://m.youtube.com/watch*ytwm_worker=1*"
    ]
  });
  const workerTab = tabs.find((tab) => tab.windowId);

  return workerTab ? workerTab.windowId : null;
}

function normalizeWorkerBounds(bounds) {
  return {
    left: normalizeWindowPosition(bounds.left, DEFAULT_WORKER_WINDOW_BOUNDS.left),
    top: normalizeWindowPosition(bounds.top, DEFAULT_WORKER_WINDOW_BOUNDS.top),
    width: normalizeWorkerWindowSize(bounds.width, DEFAULT_WORKER_WINDOW_BOUNDS.width),
    height: normalizeWorkerWindowSize(bounds.height, DEFAULT_WORKER_WINDOW_BOUNDS.height)
  };
}

function shouldIgnorePrimaryFallbackBounds(actualBounds, requestedBounds) {
  const requestedSecondary = requestedBounds.left >= DEFAULT_WORKER_WINDOW_BOUNDS.left;
  const actualPrimaryFallback = actualBounds.left < PRIMARY_SCREEN_MAX_LEFT;

  return requestedSecondary && actualPrimaryFallback;
}

function getSafeSavedWorkerBounds(bounds) {
  if (bounds.left < PRIMARY_SCREEN_MAX_LEFT || bounds.left > RIGHT_MONITOR_MAX_LEFT) {
    return {
      ...bounds,
      left: SECONDARY_TOP_LEFT_WORKER_BOUNDS.left,
      top: SECONDARY_TOP_LEFT_WORKER_BOUNDS.top
    };
  }

  return bounds;
}

function formatBounds(bounds) {
  return `${bounds.left},${bounds.top},${bounds.width}x${bounds.height}`;
}

async function createWorkerWindow(url) {
  const bounds = await getWorkerWindowBounds();
  const workerWindow = await extensionApi.windows.create({
    url,
    type: "normal",
    focused: true,
    width: bounds.width,
    height: bounds.height
  });
  await forceWorkerWindowBoundsRepeatedly(workerWindow.id, bounds);
  const tab = await getWorkerWindowTab(workerWindow);

  return {
    windowId: workerWindow.id,
    tab,
    requestedBounds: bounds,
    reused: false
  };
}

async function getWorkerWindowTab(workerWindow) {
  if (workerWindow.tabs && workerWindow.tabs[0]) {
    return workerWindow.tabs[0];
  }

  const populatedWindow = await extensionApi.windows.get(workerWindow.id, {
    populate: true
  });

  return populatedWindow.tabs && populatedWindow.tabs[0];
}

async function findOpenedWorkerTab(workerUrl) {
  if (!workerUrl) {
    return null;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tabs = await extensionApi.tabs.query({});
    const matchingTab = tabs.find((candidate) => (
      candidate.id &&
      candidate.windowId &&
      urlsMatchIgnoringEncoding(candidate.url || candidate.pendingUrl, workerUrl)
    ));

    if (matchingTab) {
      return matchingTab;
    }

    await delay(250);
  }

  return null;
}

function urlsMatchIgnoringEncoding(actualUrl, expectedUrl) {
  if (!actualUrl || !expectedUrl) {
    return false;
  }

  if (actualUrl === expectedUrl) {
    return true;
  }

  try {
    const actual = new URL(actualUrl);
    const expected = new URL(expectedUrl);
    return actual.href === expected.href;
  } catch (_error) {
    return false;
  }
}

async function forceWorkerWindowBoundsRepeatedly(windowId, bounds) {
  for (const delayMs of [0, 250, 750, 1500]) {
    setTimeout(() => {
      forceWorkerWindowBounds(windowId, bounds).catch(() => {});
    }, delayMs);
  }

  await delay(75);
}

async function rememberOpenedWorkerWindowBounds(itemId, windowId, requestedBounds) {
  await delay(1800);

  try {
    const workerWindow = await extensionApi.windows.get(windowId);
    const openedBounds = normalizeWorkerBounds({
      left: workerWindow.left,
      top: workerWindow.top,
      width: workerWindow.width,
      height: workerWindow.height
    });

    await updateQueueItem(itemId, {}, {
      event: `window-bounds-opened-${formatBounds(openedBounds)}`,
      elapsedMs: null
    });

    if (requestedBounds && openedBounds.left !== requestedBounds.left) {
      await updateQueueItem(itemId, {}, {
        event: `window-bounds-clamped-requested-${formatBounds(requestedBounds)}-actual-${formatBounds(openedBounds)}`,
        elapsedMs: null
      });
    }
  } catch (_error) {
    // Diagnostic only.
  }
}

async function forceWorkerWindowBounds(windowId, bounds) {
  await extensionApi.windows.update(windowId, {
    state: "normal"
  }).catch(() => {});

  await extensionApi.windows.update(windowId, {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
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

function tabMatchesVideo(tab, videoId) {
  const tabUrl = (tab && (tab.pendingUrl || tab.url)) || "";
  const parsedUrl = normalizeUrl(tabUrl);

  return Boolean(
    parsedUrl &&
    isYouTubeHost(parsedUrl.hostname) &&
    parsedUrl.searchParams.get("v") === videoId
  );
}

function getRequiredVideoIdFromUrl(url) {
  const videoId = extractVideoIdFromUrl(url);

  if (!videoId) {
    throw new Error("worker-target-video-id-missing");
  }

  return videoId;
}

async function waitForTabVideoUrl(tabId, videoId, timeoutMs) {
  const initialTab = await extensionApi.tabs.get(tabId);

  if (tabMatchesVideo(initialTab, videoId)) {
    return;
  }

  await withTimeout(new Promise((resolve, reject) => {
    function cleanup() {
      clearInterval(pollId);
      extensionApi.tabs.onUpdated.removeListener(onUpdated);
      extensionApi.tabs.onRemoved.removeListener(onRemoved);
    }

    async function checkCurrentTab() {
      try {
        const currentTab = await extensionApi.tabs.get(tabId);
        if (tabMatchesVideo(currentTab, videoId)) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }

    function onUpdated(updatedTabId, _changeInfo, updatedTab) {
      if (updatedTabId === tabId && tabMatchesVideo(updatedTab, videoId)) {
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

    const pollId = setInterval(() => {
      checkCurrentTab().catch(reject);
    }, 250);

    extensionApi.tabs.onUpdated.addListener(onUpdated);
    extensionApi.tabs.onRemoved.addListener(onRemoved);
    checkCurrentTab().catch(reject);
  }), timeoutMs, "tab-video-url-timeout");
}

async function injectPlayerWorker(tabId) {
  await extensionApi.tabs.executeScript(tabId, {
    file: "src/extension-api.js",
    runAt: "document_idle"
  });
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

function getWorkerItemTimeoutMs(settings) {
  const playbackMs = normalizeSettingNumber(
    settings && settings.playbackSeconds,
    DEFAULT_PLAYBACK_SECONDS,
    1,
    30
  ) * 1000;
  return Math.min(
    WORKER_TIMEOUT_MS,
    WORKER_TIMEOUT_BASE_MS + playbackMs + WORKER_TIMEOUT_BUFFER_MS
  );
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

  resolveActiveWorker(message.result || {
      ok: false,
      error: "missing-worker-result"
  });
}

function handleWorkerStatus(message) {
  if (!activeWorker || activeWorker.itemId !== message.itemId) {
    return;
  }

  activeWorker.lastStatus = message.status;
  const playbackMode = getStatusPlaybackMode(message.status);
  updateQueueItem(message.itemId, {
    workerStatus: message.status,
    ...(playbackMode ? { playbackMode } : {})
  }, {
    event: message.status,
    elapsedMs: message.elapsedMs
  }).then((item) => notifyQueueUpdated({ item })).catch(console.error);

  if (message.status === "completed-playback") {
    resolveActiveWorker({
      ok: true,
      playbackMode: getPlaybackModeFromResult(null),
      fallbackCompletedFromStatus: true
    });
  }
}

function resolveActiveWorker(result) {
  if (!activeWorker || activeWorker.resultResolved) {
    return;
  }

  activeWorker.resultResolved = true;

  if (activeWorker.resolve) {
    activeWorker.resolve(result);
  }
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

async function setupWorker(item, settings, previousTab) {
  let tab = null;
  let workerWindowId = null;
  let requestedBounds = null;

  if (settings.workerMode === "window") {
    const targetUrl = item.targetWorkerUrl || buildWatchUrl(item.videoId);
    let workerWindow = await useRetainedWorkerWindow(targetUrl);

    if (workerWindow) {
      tab = workerWindow.tab;
      workerWindowId = workerWindow.windowId;
      requestedBounds = workerWindow.requestedBounds;
      await updateQueueItem(item.id, {}, {
        event: `worker-window-reused-${formatBounds(requestedBounds)}`,
        elapsedMs: null
      }).catch(() => {});
    } else if (!item.openedWorkerUrl) {
      workerWindow = await createWorkerWindow(targetUrl);
      tab = workerWindow.tab;
      workerWindowId = workerWindow.windowId;
      requestedBounds = workerWindow.requestedBounds;
      await updateQueueItem(item.id, {}, {
        event: `worker-window-created-${formatBounds(requestedBounds)}`,
        elapsedMs: null
      }).catch(() => {});
      await extensionApi.storage.local.set({ [WAITING_FOR_DIRECT_OPEN_KEY]: false });
    } else {
      tab = await findOpenedWorkerTab(item.openedWorkerUrl);
      if (tab) {
        workerWindowId = tab.windowId;
        if (!isWorkerWatchUrl(tab.url || tab.pendingUrl) || !urlsMatchIgnoringEncoding(tab.url || tab.pendingUrl, targetUrl)) {
          tab = await extensionApi.tabs.update(tab.id, { url: targetUrl, active: true, muted: true });
        }
        const openedWindow = await extensionApi.windows.get(workerWindowId);
        requestedBounds = normalizeWorkerBounds(openedWindow);
        await updateQueueItem(item.id, {}, {
          event: `content-window-open-attached-${formatBounds(requestedBounds)}`,
          elapsedMs: null
        }).catch(() => {});
      } else {
        workerWindow = await createWorkerWindow(targetUrl);
        tab = workerWindow.tab;
        workerWindowId = workerWindow.windowId;
        requestedBounds = workerWindow.requestedBounds;
        await updateQueueItem(item.id, {}, {
          event: `direct-window-not-found-created-${formatBounds(requestedBounds)}`,
          elapsedMs: null
        }).catch(() => {});
        await extensionApi.storage.local.set({ [WAITING_FOR_DIRECT_OPEN_KEY]: false });
      }
    }
  } else {
    tab = await extensionApi.tabs.create({
      url: buildWatchUrl(item.videoId),
      active: false
    });
    workerWindowId = tab.windowId;
  }

  if (!tab || !tab.id) {
    throw new Error("worker-tab-not-found");
  }

  return {
    tab,
    workerWindowId,
    requestedBounds,
    previousTabId: previousTab && previousTab.id !== tab.id ? previousTab.id : null,
    previousWindowId: previousTab && previousTab.windowId !== workerWindowId ? previousTab.windowId : null
  };
}

async function finishQueueItem(item, result, settings) {
  const completedItem = await updateQueueItem(item.id, {
    status: result && result.ok ? "completed" : "failed",
    completedAt: new Date().toISOString(),
    playbackSeconds: result && result.playbackSeconds,
    seekFromEndSeconds: settings.seekFromEndSeconds,
    seekTime: result && result.seekTime,
    duration: result && result.duration,
    title: cleanTitle(result && result.title) || item.title,
    playbackMode: getPlaybackModeFromResult(result),
    debugSummary: getDebugSummary(result),
    error: result && result.ok ? null : ((result && result.error) || "worker-failed")
  });
  await notifyQueueUpdated({ item: completedItem });
}

async function handleQueueItemError(item, error) {
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
}

async function cleanupWorker(worker, workerWindowId, tab) {
  if (worker) {
    const settings = await getSettings();
    const shouldRetain = (
      settings.workerMode === "window" &&
      await hasPendingQueueItems() &&
      await retainWorkerForNextItem(worker)
    );

    if (!shouldRetain) {
      await closeWorkerQuietly(worker);
    }
  } else if (workerWindowId) {
    await closeWorkerQuietly({ windowId: workerWindowId, tabId: tab && tab.id });
  } else if (tab && tab.id) {
    await closeTabQuietly(tab.id);
  }

  activeWorker = null;
  await armDirectOpenForPendingWindowQueue();
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

    const workerSetup = await setupWorker(item, settings, previousTab);
    tab = workerSetup.tab;
    workerWindowId = workerSetup.workerWindowId;

    activeWorker = {
      itemId: item.id,
      tabId: tab.id,
      windowId: workerWindowId,
      requestedBounds: workerSetup.requestedBounds,
      lastStatus: settings.workerMode === "window" ? "window-created" : "tab-created",
      previousTabId: workerSetup.previousTabId,
      previousWindowId: workerSetup.previousWindowId
    };

    await extensionApi.tabs.update(tab.id, { muted: true });
    await waitForTabVideoUrl(tab.id, item.videoId, 30000);
    await waitForTabComplete(tab.id, 45000);
    await injectPlayerWorker(tab.id);

    const startResponse = await sendWorkerMessageWithRetry(tab.id, {
      type: "start-watch-simulation",
      itemId: item.id,
      playbackSeconds: settings.playbackSeconds,
      seekFromEndSeconds: settings.seekFromEndSeconds
    });

    if (startResponse && startResponse.ok === false) {
      throw new Error((startResponse && startResponse.error) || "worker-start-failed");
    }

    const result = await waitForWorkerResult(item.id, getWorkerItemTimeoutMs(settings));
    await finishQueueItem(item, result, settings);
  } catch (error) {
    await handleQueueItemError(item, error);
  } finally {
    await cleanupWorker(activeWorker, workerWindowId, tab);
  }
}

async function armDirectOpenForPendingWindowQueue() {
  const settings = await getSettings();

  if (settings.workerMode !== "window" || settings.queuePaused) {
    return;
  }

  const queue = await getQueue();
  const hasPending = queue.some((entry) => entry.status === "pending");

  await extensionApi.storage.local.set({
    [WAITING_FOR_DIRECT_OPEN_KEY]: hasPending && !retainedWorker
  });
  await notifyContentQueueState();
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

async function resetDirectOpenWaitingItems() {
  const queue = await getQueue();
  let changed = false;
  const nextQueue = queue.map((item) => {
    if (
      item.status !== "running" ||
      item.workerStatus !== "waiting-for-direct-window-open"
    ) {
      return item;
    }

    changed = true;
    return {
      ...item,
      status: "pending",
      workerStatus: null,
      error: null,
      updatedAt: new Date().toISOString()
    };
  });

  if (changed) {
    await setQueue(nextQueue);
    await extensionApi.storage.local.set({
      [WAITING_FOR_DIRECT_OPEN_KEY]: false
    });
    await notifyQueueUpdated();
  }
}

async function processQueue() {
  if (activeWorker) {
    return;
  }

  const settings = await getSettings();

  if (settings.queuePaused) {
    await extensionApi.storage.local.set({
      [WAITING_FOR_DIRECT_OPEN_KEY]: false
    });
    await refreshBadge();
    await notifyContentQueueState();
    return;
  }

  await resetDirectOpenWaitingItems();

  const queue = await getQueue();
  const item = queue.find((entry) => entry.status === "pending");

  if (!item) {
    if (retainedWorker) {
      await closeWorkerQuietly(retainedWorker);
      retainedWorker = null;
    }

    await extensionApi.storage.local.set({
      [WAITING_FOR_DIRECT_OPEN_KEY]: false
    });
    await refreshBadge();
    await notifyContentQueueState();
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
      contexts: ["video"],
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

extensionApi.tabs.onCreated.addListener((tab) => {
  muteWorkerTabIfNeeded(tab.id, tab.url || tab.pendingUrl).catch(console.error);
});

extensionApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  muteWorkerTabIfNeeded(tabId, changeInfo.url || (tab && tab.url)).catch(console.error);
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
