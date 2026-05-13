"use strict";

function getExtensionApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }

  return chrome;
}

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
const lowQualityEnabled = document.getElementById("lowQualityEnabled");
const windowBounds = document.getElementById("windowBounds");
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
      return "Failed: hidden autoplay blocked by Firefox/YouTube";
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
  lowQualityEnabled.checked = settings.lowQualityEnabled !== false;
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

lowQualityEnabled.addEventListener("change", async () => {
  await updateSettings({
    lowQualityEnabled: lowQualityEnabled.checked
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
