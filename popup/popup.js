"use strict";

const extensionApi = getExtensionApi();
const queueList = document.getElementById("queueList");
const emptyState = document.getElementById("emptyState");
const summary = document.getElementById("summary");
const clearButton = document.getElementById("clearButton");
const optionsToggle = document.getElementById("optionsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const debugToggle = document.getElementById("debugToggle");
const workerMode = document.getElementById("workerMode");
const playbackSeconds = document.getElementById("playbackSeconds");
const seekFromEndSeconds = document.getElementById("seekFromEndSeconds");
const maxQueueSize = document.getElementById("maxQueueSize");
const windowBounds = document.getElementById("windowBounds");
const channelStartDate = document.getElementById("channelStartDate");
const channelEndDate = document.getElementById("channelEndDate");
const channelTodayButton = document.getElementById("channelTodayButton");
const channelOldestButton = document.getElementById("channelOldestButton");
const scanChannelButton = document.getElementById("scanChannelButton");
const channelScanStatus = document.getElementById("channelScanStatus");
const pauseButton = document.getElementById("pauseButton");
const resetWindowButton = document.getElementById("resetWindowButton");
const saveWindowButton = document.getElementById("saveWindowButton");
const stopButton = document.getElementById("stopButton");
const retryFailedButton = document.getElementById("retryFailedButton");
const clearCompletedButton = document.getElementById("clearCompletedButton");
const clearFailedButton = document.getElementById("clearFailedButton");
const exportDebugButton = document.getElementById("exportDebugButton");
let debugVisible = false;
let currentSettings = {};
let currentQueue = [];

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function parseInputDate(value) {
  const trimmed = String(value || "").trim();
  let year;
  let month;
  let day;
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

    if (!match) {
      return null;
    }

    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function isOldestDateShortcut(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "oldest" || normalized === "end";
}

function formatDateInput(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  return `${day}.${month}.${year}`;
}

function getNormalizedInputRange() {
  const startValue = String(channelStartDate.value || "").trim();
  const startDate = startValue ? parseInputDate(startValue) : new Date();
  const endIsOldest = isOldestDateShortcut(channelEndDate.value);
  const endDate = endIsOldest ? new Date(0) : parseInputDate(channelEndDate.value);

  if (!startDate || !endDate) {
    return null;
  }

  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const earlier = startDay.getTime() <= endDay.getTime() ? startDay : endDay;
  const later = startDay.getTime() <= endDay.getTime() ? endDay : startDay;
  const inclusiveEnd = new Date(
    later.getFullYear(),
    later.getMonth(),
    later.getDate(),
    23,
    59,
    59,
    999
  );

  return {
    startMs: earlier.getTime(),
    endMs: inclusiveEnd.getTime(),
    startIso: earlier.toISOString(),
    endIso: inclusiveEnd.toISOString()
  };
}

function setChannelStatus(text) {
  channelScanStatus.textContent = text;
}

function getChannelVideosUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch (_error) {
    return null;
  }

  if (!isYouTubeHost(url.hostname)) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] || "";
  const validPrefix = (
    first.startsWith("@") ||
    ["channel", "c", "user"].includes(first.toLowerCase())
  );

  if (!validPrefix) {
    return null;
  }

  const baseParts = first.startsWith("@")
    ? [first]
    : parts.slice(0, 2);

  if (baseParts.length < 1 || (!first.startsWith("@") && baseParts.length < 2)) {
    return null;
  }

  url.pathname = `/${baseParts.join("/")}/videos`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForTabComplete(tabId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tab = await extensionApi.tabs.get(tabId);

    if (tab.status === "complete") {
      return;
    }

    await delay(250);
  }
}

async function sendTabMessageWithRetry(tabId, message) {
  let lastError = null;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      return await extensionApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  throw lastError || new Error("content-script-not-ready");
}

async function getActiveYouTubeTab() {
  const tabs = await extensionApi.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0] || null;
}

async function scanChannelTimeframe() {
  const range = getNormalizedInputRange();

  if (!range) {
    setChannelStatus("Enter valid dates like 14.04.2026 or 2026-04-14. End may be oldest.");
    return;
  }

  scanChannelButton.disabled = true;
  setChannelStatus("Opening channel videos page...");

  try {
    const tab = await getActiveYouTubeTab();
    const videosUrl = tab && getChannelVideosUrl(tab.url);

    if (!tab || !tab.id || !videosUrl) {
      setChannelStatus("Open a YouTube™ channel page or Videos tab first.");
      return;
    }

    if (tab.url !== videosUrl) {
      await extensionApi.tabs.update(tab.id, {
        url: videosUrl,
        active: true
      });
      await waitForTabComplete(tab.id);
      await delay(700);
    }

    setChannelStatus("Scanning loaded channel videos...");
    const scanResult = await sendTabMessageWithRetry(tab.id, {
      type: "scan-channel-timeframe",
      range
    });

    if (!scanResult || scanResult.ok === false) {
      setChannelStatus(`Scan failed: ${(scanResult && scanResult.error) || "unknown-error"}`);
      return;
    }

    setChannelStatus(`Scanned ${scanResult.scanned}, matched ${scanResult.matched}. Queueing...`);
    const enqueueResult = await extensionApi.runtime.sendMessage({
      type: "bulk-enqueue-video-urls",
      videos: scanResult.videos || [],
      source: "channel-timeframe",
      channelUrl: videosUrl
    });

    if (!enqueueResult || enqueueResult.ok === false) {
      setChannelStatus(`Queue failed: ${(enqueueResult && enqueueResult.error) || "unknown-error"}`);
      return;
    }

    setChannelStatus([
      `Scanned ${scanResult.scanned}`,
      `matched ${scanResult.matched}`,
      `queued ${enqueueResult.queued}`,
      `duplicate ${enqueueResult.duplicate}`,
      `skipped ${enqueueResult.skipped + (scanResult.skippedUnparseable || 0)}`,
      `errors ${enqueueResult.errors}`
    ].join(" / "));
    await loadQueue();
  } catch (error) {
    setChannelStatus(`Scan failed: ${error && error.message ? error.message : String(error)}`);
  } finally {
    scanChannelButton.disabled = false;
  }
}

function createQueueNode(item) {
  const node = document.createElement("li");
  node.className = `queue-item queue-item-${item.status}`;

  const topRow = document.createElement("div");
  topRow.className = "queue-row";

  const videoId = document.createElement("span");
  videoId.className = "video-id";
  videoId.textContent = item.videoId;

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = item.title || item.videoId;
  title.title = item.title || item.videoId;

  const status = document.createElement("span");
  status.className = "status";
  status.textContent = item.status;

  const source = document.createElement("div");
  source.className = "source";
  source.title = item.sourceUrl;
  source.textContent = item.sourceUrl;

  const created = document.createElement("div");
  created.className = "created";
  created.textContent = getItemDetailText(item);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (item.status === "failed" || item.status === "completed") {
    actions.append(createActionButton("Retry", () => retryItem(item.id)));
  }

  actions.append(createActionButton("Remove", () => removeItem(item.id)));

  const debug = document.createElement("div");
  debug.className = "debug";
  debug.append(createDebugTimelineNode(item));

  topRow.append(title, status);
  node.append(topRow, videoId, source, created, actions, debug);

  return node;
}

function createActionButton(label, onClick) {
  const button = document.createElement("button");
  button.className = "item-action";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    onClick().catch(console.error);
  });
  return button;
}

function createDebugTimelineNode(item) {
  const timeline = document.createElement("div");
  timeline.className = "debug-timeline";

  const events = Array.isArray(item.debugEvents) ? item.debugEvents : [];
  const visibleEvents = events.slice(-16);

  if (!visibleEvents.length) {
    timeline.textContent = "No worker events yet";
    return timeline;
  }

  timeline.textContent = visibleEvents.map(formatDebugEvent).join(" -> ");
  timeline.title = events.map((entry) => `${formatDate(entry.at)} ${formatDebugEvent(entry)}`).join("\n");
  return timeline;
}

function formatDebugEvent(entry) {
  const elapsed = typeof entry.elapsedMs === "number"
    ? `${(entry.elapsedMs / 1000).toFixed(1)}s `
    : "";

  return `${elapsed}${entry.event}`;
}

function getItemDetailText(item) {
  if (item.status === "failed" && item.error) {
    if (item.error.startsWith("hidden-autoplay-blocked")) {
      return "Failed: hidden autoplay blocked by Firefox/YouTube™";
    }

    if (item.error.startsWith("foreground-assist-playback-blocked")) {
      return "Failed: worker window could not start playback";
    }

    if (item.error.startsWith("foreground-assist-playback-did-not-advance")) {
      return "Failed: playback did not advance after worker window start";
    }

    return item.workerStatus
      ? `Failed: ${item.error} (${item.workerStatus})`
      : `Failed: ${item.error}`;
  }

  if (item.status === "completed") {
    return `Completed ${formatDate(item.completedAt || item.updatedAt)}`;
  }

  if (item.status === "running") {
    return item.workerStatus
      ? `Running: ${item.workerStatus}`
      : "Running in worker window";
  }

  return `Queued ${formatDate(item.createdAt)}`;
}

function renderQueue(queue) {
  currentQueue = queue;
  document.body.classList.toggle("debug-visible", debugVisible);
  queueList.replaceChildren();

  for (const item of queue) {
    queueList.append(createQueueNode(item));
  }

  summary.textContent = getQueueSummary(queue);
  emptyState.hidden = queue.length !== 0;
  clearButton.disabled = queue.length === 0;
}

function getQueueSummary(queue) {
  const counts = queue.reduce((accumulator, item) => {
    accumulator[item.status] = (accumulator[item.status] || 0) + 1;
    return accumulator;
  }, {});

  const parts = [
    counts.running ? `${counts.running} running` : null,
    counts.pending ? `${counts.pending} pending` : null,
    counts.completed ? `${counts.completed} completed` : null,
    counts.failed ? `${counts.failed} failed` : null
  ].filter(Boolean);

  const text = parts.length ? parts.join(" / ") : "No queued videos";
  return currentSettings.queuePaused ? `Paused / ${text}` : text;
}

async function loadQueue() {
  const response = await extensionApi.runtime.sendMessage({
    type: "get-queue"
  });

  renderQueue(response.queue || []);
}

async function loadSettings() {
  const response = await extensionApi.runtime.sendMessage({
    type: "get-settings"
  });
  applySettings(response.settings || {});
}

function applySettings(settings) {
  currentSettings = settings;
  workerMode.value = settings.workerMode || "window";
  playbackSeconds.value = settings.playbackSeconds || 5;
  seekFromEndSeconds.value = settings.seekFromEndSeconds || 30;
  maxQueueSize.value = settings.maxQueueSize || 20;
  pauseButton.textContent = settings.queuePaused ? "Resume queue" : "Pause queue";
  windowBounds.textContent = formatWindowBounds(settings.workerWindowBounds);
  renderQueue(currentQueue);
}

function formatWindowBounds(bounds) {
  if (!bounds) {
    return "Worker window: default position";
  }

  const parts = [
    Number.isFinite(bounds.left) ? `x ${bounds.left}` : null,
    Number.isFinite(bounds.top) ? `y ${bounds.top}` : null,
    Number.isFinite(bounds.width) ? `${bounds.width}w` : null,
    Number.isFinite(bounds.height) ? `${bounds.height}h` : null
  ].filter(Boolean);

  return parts.length ? `Worker window: ${parts.join(", ")}` : "Worker window: default position";
}

async function updateSettings(patch) {
  const response = await extensionApi.runtime.sendMessage({
    type: "update-settings",
    settings: patch
  });

  applySettings(response.settings || {});
}

async function clearQueue() {
  const response = await extensionApi.runtime.sendMessage({
    type: "clear-queue"
  });

  renderQueue(response.queue || []);
}

async function retryItem(itemId) {
  const response = await extensionApi.runtime.sendMessage({
    type: "retry-queue-item",
    itemId
  });

  renderQueue(response.queue || []);
}

async function removeItem(itemId) {
  const response = await extensionApi.runtime.sendMessage({
    type: "remove-queue-item",
    itemId
  });

  renderQueue(response.queue || []);
}

async function sendQueueAction(type) {
  const response = await extensionApi.runtime.sendMessage({ type });
  renderQueue(response.queue || []);
}

async function exportDebugLog() {
  const response = await extensionApi.runtime.sendMessage({
    type: "get-debug-export"
  });
  const blob = new Blob([JSON.stringify(response, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = `youtube-watched-debug-${timestamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

clearButton.addEventListener("click", () => {
  clearQueue().catch(console.error);
});

optionsToggle.addEventListener("click", () => {
  const expanded = optionsToggle.getAttribute("aria-expanded") === "true";
  optionsToggle.setAttribute("aria-expanded", String(!expanded));
  settingsPanel.hidden = expanded;
});

debugToggle.addEventListener("click", () => {
  debugVisible = !debugVisible;
  debugToggle.setAttribute("aria-pressed", String(debugVisible));
  loadQueue().catch(console.error);
});

workerMode.addEventListener("change", async () => {
  await updateSettings({
    workerMode: workerMode.value
  });
});

playbackSeconds.addEventListener("change", async () => {
  await updateSettings({
    playbackSeconds: playbackSeconds.value
  });
});

seekFromEndSeconds.addEventListener("change", async () => {
  await updateSettings({
    seekFromEndSeconds: seekFromEndSeconds.value
  });
});

maxQueueSize.addEventListener("change", async () => {
  await updateSettings({
    maxQueueSize: maxQueueSize.value
  });
});


pauseButton.addEventListener("click", async () => {
  await updateSettings({
    queuePaused: !currentSettings.queuePaused
  });
  await loadQueue();
});

resetWindowButton.addEventListener("click", async () => {
  await extensionApi.runtime.sendMessage({
    type: "reset-worker-window-bounds"
  });
  await loadSettings();
});

saveWindowButton.addEventListener("click", async () => {
  const response = await extensionApi.runtime.sendMessage({
    type: "save-current-worker-window-bounds"
  });
  await loadSettings();

  if (response && response.ok === false) {
    windowBounds.textContent = "No worker window found. Start one, move it, then save.";
  } else {
    windowBounds.textContent = "Worker window position saved.";
    setTimeout(() => {
      loadSettings().catch(console.error);
    }, 1200);
  }
});

stopButton.addEventListener("click", () => {
  sendQueueAction("stop-worker").catch(console.error);
});

retryFailedButton.addEventListener("click", () => {
  sendQueueAction("retry-failed").catch(console.error);
});

clearCompletedButton.addEventListener("click", () => {
  sendQueueAction("clear-completed").catch(console.error);
});

clearFailedButton.addEventListener("click", () => {
  sendQueueAction("clear-failed").catch(console.error);
});

exportDebugButton.addEventListener("click", () => {
  exportDebugLog().catch(console.error);
});

channelTodayButton.addEventListener("click", () => {
  channelStartDate.value = formatDateInput(new Date());
  setChannelStatus("Start date set to today.");
});

channelOldestButton.addEventListener("click", () => {
  channelEndDate.value = "oldest";
  setChannelStatus("End date set to oldest reachable video.");
});

scanChannelButton.addEventListener("click", () => {
  scanChannelTimeframe().catch(console.error);
});

extensionApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "queue-updated") {
    loadQueue().catch(console.error);
  }
});

loadQueue().catch((error) => {
  console.error(error);
  summary.textContent = "Unable to load queue";
});

loadSettings().catch(console.error);
