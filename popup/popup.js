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
const maxSavedQueueItems = document.getElementById("maxSavedQueueItems");
const savedQueueInfo = document.getElementById("savedQueueInfo");
const windowBounds = document.getElementById("windowBounds");
const channelStartDate = document.getElementById("channelStartDate");
const channelEndDate = document.getElementById("channelEndDate");
const channelTodayButton = document.getElementById("channelTodayButton");
const channelOldestButton = document.getElementById("channelOldestButton");
const scanChannelButton = document.getElementById("scanChannelButton");
const channelScanStatus = document.getElementById("channelScanStatus");
const markPlaylistButton = document.getElementById("markPlaylistButton");
const cancelPlaylistButton = document.getElementById("cancelPlaylistButton");
const cancelPlaylistLabel = document.getElementById("cancelPlaylistLabel");
const playlistStatus = document.getElementById("playlistStatus");
const resetWindowButton = document.getElementById("resetWindowButton");
const saveWindowButton = document.getElementById("saveWindowButton");
const retryFailedButton = document.getElementById("retryFailedButton");
const clearCompletedButton = document.getElementById("clearCompletedButton");
const clearFailedButton = document.getElementById("clearFailedButton");
const exportDebugButton = document.getElementById("exportDebugButton");
const hero = document.getElementById("hero");
const heroEyebrow = document.getElementById("heroEyebrow");
const heroTitle = document.getElementById("heroTitle");
const heroCount = document.getElementById("heroCount");
const heroBar = document.getElementById("heroBar");
const heroProgress = document.getElementById("heroProgress");
const heroNow = document.getElementById("heroNow");
const heroNowText = document.getElementById("heroNowText");
const heroNowExtra = document.getElementById("heroNowExtra");
const heroTip = document.getElementById("heroTip");
const heroPrimary = document.getElementById("heroPrimary");
const heroSecondary = document.getElementById("heroSecondary");
const heroFailView = document.getElementById("heroFailView");
const miniEyebrow = document.getElementById("miniEyebrow");
const miniDetail = document.getElementById("miniDetail");
const miniAction = document.getElementById("miniAction");
const tabQueue = document.getElementById("tabQueue");
const tabAdd = document.getElementById("tabAdd");
const panelQueue = document.getElementById("panelQueue");
const panelAdd = document.getElementById("panelAdd");
const filters = document.getElementById("filters");
const filterEmpty = document.getElementById("filterEmpty");
const countAll = document.getElementById("countAll");
const countPending = document.getElementById("countPending");
const countDone = document.getElementById("countDone");
const countFailed = document.getElementById("countFailed");
const queueCount = document.getElementById("queueCount");
const jobCard = document.getElementById("jobCard");
const jobName = document.getElementById("jobName");
const jobBar = document.getElementById("jobBar");
const jobMeta = document.getElementById("jobMeta");
const drawer = document.getElementById("drawer");
const drawerBack = document.getElementById("drawerBack");
const drawerClose = document.getElementById("drawerClose");
const savedChip = document.getElementById("savedChip");
const advToggle = document.getElementById("advToggle");
const advBody = document.getElementById("advBody");
const clearAdvanced = document.getElementById("clearAdvanced");
let debugVisible = false;
let currentSettings = {};
let currentQueue = [];
let currentPlaylistJob = null;
let playlistScanning = false;
let currentFilter = "all";
let currentTab = "queue";
let savedTimer = 0;

const THUMB_COLORS = ["#6b7fb3", "#b07a68", "#5d8f83", "#8a7ba8", "#a88a55", "#4f7fa8", "#9a6b7c", "#5f7a6b"];
const STATUS_LABELS = { pending: "Queued", running: "Playing", completed: "Watched", failed: "Failed" };
const STATUS_ICONS = { pending: "i-clock", running: "i-play", completed: "i-check", failed: "i-alert" };

function thumbColor(videoId) {
  let hash = 0;
  for (const character of String(videoId || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return THUMB_COLORS[hash % THUMB_COLORS.length];
}

function sourceLabel(item) {
  const source = String(item.source || "");
  if (item.playlistId) return "from playlist";
  if (source === "channel-timeframe") return "channel scan";
  if (source === "context-menu" || source === "link") return "context menu";
  return item.sourceUrl ? "from YouTube" : "added manually";
}

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
  } catch {
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

function setPlaylistStatus(text) {
  playlistStatus.textContent = text;
}

// Finished playlist items can be trimmed from the queue while the job is still
// running, so the job's own counters are the source of truth. Older jobs saved
// before those counters existed fall back to counting queue items.
function getPlaylistDoneCount(job, queued) {
  if (Number.isFinite(job.completedCount) && Number.isFinite(job.failedCount)) {
    // A retried item is counted twice, so never report more done than queued.
    return Math.min(queued, job.completedCount + job.failedCount);
  }

  return currentQueue.filter((item) => (
    item.playlistId === job.playlistId &&
    (item.status === "completed" || item.status === "failed")
  )).length;
}

const PLAYLIST_SCAN_ERRORS = {
  "not-playlist-page": "This tab is not a YouTube™ playlist page.",
  "playlist-not-ready": "The playlist page did not finish opening. Try again.",
  "playlist-videos-not-loaded": "No videos loaded. Scroll the playlist once, then try again.",
  "content-script-not-ready": "Reload the playlist page, then try again.",
  "empty-playlist": "This playlist has no available videos to mark."
};

function describePlaylistError(code) {
  return PLAYLIST_SCAN_ERRORS[code] || `Playlist scan failed: ${code || "unknown-error"}`;
}

// After tabs.update the old document can still answer, so retry until the tab
// reports the playlist we actually asked for.
async function requestPlaylistScan(tabId, playlistId) {
  let result = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    result = await sendTabMessageWithRetry(tabId, {
      type: "scan-playlist-videos",
      playlistId
    });

    if (!result || result.error !== "playlist-not-ready") {
      return result;
    }

    await delay(500);
  }

  return result;
}

async function markPlaylistAsWatched() {
  markPlaylistButton.disabled = true;
  playlistScanning = true;
  setPlaylistStatus("Opening playlist...");

  try {
    const tab = await getActiveYouTubeTab();
    const playlistId = tab && extractPlaylistIdFromUrl(tab.url);

    if (!tab || !tab.id || !playlistId) {
      setPlaylistStatus("Open a YouTube™ playlist page first.");
      return;
    }

    const playlistUrl = buildPlaylistUrl(playlistId);

    if (tab.url !== playlistUrl) {
      await extensionApi.tabs.update(tab.id, {
        url: playlistUrl,
        active: true
      });
      await waitForTabComplete(tab.id);
      await delay(700);
    }

    setPlaylistStatus("Loading playlist videos...");
    const scanResult = await requestPlaylistScan(tab.id, playlistId);

    if (!scanResult || scanResult.ok === false) {
      setPlaylistStatus(describePlaylistError(scanResult && scanResult.error));
      return;
    }

    const response = await extensionApi.runtime.sendMessage({
      type: "start-playlist-job",
      playlistId: scanResult.playlistId,
      playlistUrl: scanResult.playlistUrl,
      title: scanResult.title,
      videos: scanResult.videos || []
    });

    if (!response || response.ok === false) {
      setPlaylistStatus(describePlaylistError(response && response.error));
      return;
    }

    playlistScanning = false;
    renderQueue(response.queue || [], response.playlistJob);
  } catch (error) {
    setPlaylistStatus(describePlaylistError(error && error.message));
  } finally {
    playlistScanning = false;
    markPlaylistButton.disabled = false;
  }
}

async function cancelPlaylistJob() {
  const hadBacklog = Boolean(currentPlaylistJob && currentPlaylistJob.videos.length);
  const response = await extensionApi.runtime.sendMessage({
    type: "cancel-playlist-job"
  });

  renderQueue(response.queue || [], null);
  setPlaylistStatus(hadBacklog
    ? "Stopped adding playlist videos. Already queued videos are kept."
    : "Playlist progress dismissed.");
}

function renderPlaylistProgress() {
  // A scan in flight owns the status line; queue updates from the running worker
  // would otherwise overwrite its progress with the previous job's numbers.
  if (playlistScanning) {
    return;
  }

  const job = currentPlaylistJob;

  if (!job) {
    cancelPlaylistButton.hidden = true;
    return;
  }

  const remaining = job.videos.length;
  const queued = Math.max(0, (job.total || 0) - remaining);
  const done = getPlaylistDoneCount(job, queued);
  const name = job.title || job.playlistId;

  cancelPlaylistButton.hidden = false;
  cancelPlaylistLabel.textContent = remaining ? "Cancel" : "Dismiss";
  setPlaylistStatus(remaining
    ? `${name}: ${job.total - remaining}/${job.total} queued, ${done} done`
    : `${name}: all ${job.total} queued, ${done} done`);
}

function iconSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${name}`);
  svg.appendChild(use);
  return svg;
}

function createQueueNode(item) {
  const node = document.createElement("li");
  node.className = `queue-item queue-item-${item.status} qi`;
  node.dataset.status = item.status;
  node.title = `${item.title || item.videoId} - ${item.videoId}`;

  const thumbnailIcon = item.status === "completed" ? "i-check" : item.status === "failed" ? "i-alert" : "i-play";
  const thumb = document.createElement("div");
  thumb.className = "qi-thumb";
  thumb.style.setProperty("--th", thumbColor(item.videoId));
  thumb.append(iconSvg(thumbnailIcon));

  const main = document.createElement("div");
  main.className = "qi-main";

  const title = document.createElement("div");
  title.className = "qi-title";
  title.textContent = item.title || item.videoId;

  const meta = document.createElement("div");
  meta.className = "qi-meta";
  meta.textContent = getItemDetailText(item);

  const tags = document.createElement("div");
  tags.className = "qi-tags";

  const pill = document.createElement("span");
  pill.className = `pill pill-${item.status}`;
  pill.append(iconSvg(STATUS_ICONS[item.status] || "i-clock"));
  pill.append(document.createTextNode(STATUS_LABELS[item.status] || item.status));

  const source = document.createElement("span");
  source.className = "qi-src";
  source.textContent = sourceLabel(item);
  tags.append(pill, source);
  main.append(title, meta, tags);

  const actions = document.createElement("div");
  actions.className = "qi-actions";
  if (item.status === "failed" || item.status === "completed") {
    actions.append(createIconAction("i-retry", "Retry", () => retryItem(item.id)));
  }
  const removeButton = createIconAction("i-trash", "Remove", () => removeItem(item.id));
  removeButton.classList.add("danger");
  actions.append(removeButton);

  const debug = document.createElement("div");
  debug.className = "debug";
  if (item.debugSummary) {
    const debugSummaryNode = document.createElement("div");
    debugSummaryNode.className = "debug-summary";
    debugSummaryNode.textContent = item.debugSummary;
    debug.append(debugSummaryNode);
  }
  debug.append(createDebugTimelineNode(item));

  node.append(thumb, main, actions, debug);
  return node;
}

function createIconAction(iconName, label, onClick) {
  const button = document.createElement("button");
  button.className = "icon-btn";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(iconSvg(iconName));
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

const queueNodes = new Map();

function itemSignature(item) {
  return [
    item.status,
    item.workerStatus || "",
    item.updatedAt || "",
    item.title || "",
    item.error || "",
    (item.debugEvents || []).length
  ].join("|");
}

function getQueueCounts(queue) {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
  queue.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
      counts[item.status] += 1;
    }
  });
  return counts;
}

function renderFilterCounts(queue) {
  const counts = getQueueCounts(queue);
  countAll.textContent = String(queue.length);
  countPending.textContent = String(counts.pending + counts.running);
  countDone.textContent = String(counts.completed);
  countFailed.textContent = String(counts.failed);
  queueCount.textContent = String(queue.length);
}

function applyFilter() {
  let visible = 0;
  for (const entry of queueNodes.values()) {
    const status = entry.node.dataset.status;
    const show = currentFilter === "all" ||
      (currentFilter === "pending" && (status === "pending" || status === "running")) ||
      ((currentFilter === "completed" || currentFilter === "done") && status === "completed") ||
      status === currentFilter;
    entry.node.hidden = !show;
    if (show) visible += 1;
  }
  filterEmpty.hidden = !(currentQueue.length > 0 && visible === 0);
}

function setFilter(filter) {
  currentFilter = filter;
  Array.from(filters.querySelectorAll("[data-filter]")).forEach((button) => {
    button.classList.toggle("on", button.dataset.filter === filter);
  });
  applyFilter();
}

function setTab(tab) {
  currentTab = tab;
  tabQueue.classList.toggle("on", tab === "queue");
  tabAdd.classList.toggle("on", tab === "add");
  tabQueue.setAttribute("aria-selected", String(tab === "queue"));
  tabAdd.setAttribute("aria-selected", String(tab === "add"));
  panelQueue.hidden = tab !== "queue";
  panelAdd.hidden = tab !== "add";
  hero.classList.toggle("compact", tab === "add");
}

function openDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  optionsToggle.setAttribute("aria-expanded", String(open));
}

function savedFlash() {
  savedChip.classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(function () {
    savedChip.classList.remove("on");
  }, 1500);
}

function renderJobCard(job) {
  if (!job || !Array.isArray(job.videos) || !job.videos.length) {
    jobCard.hidden = true;
    return;
  }
  jobCard.hidden = false;
  jobName.textContent = job.title || "Playlist";
  const queued = Math.max(0, (job.total || 0) - job.videos.length);
  const done = getPlaylistDoneCount(job, queued);
  jobMeta.textContent = `${queued}/${job.total} queued - ${done} done`;
  jobBar.style.width = `${job.total ? Math.round(queued / job.total * 100) : 0}%`;
}

function renderHero(queue, job) {
  const counts = getQueueCounts(queue);
  const total = queue.length;
  const active = counts.pending + counts.running;
  const paused = Boolean(currentSettings.queuePaused);
  const percentage = total ? Math.round((counts.completed / total) * 100) : 0;
  let state;

  if (!total) {
    state = {
      tone: "idle", eyebrow: "All clear", title: "Nothing in the queue",
      detail: "Everything you marked is up to date", progress: 0,
      now: "", extra: "", primary: "Add videos", action: "add",
      secondary: false, failView: false, mini: "Add"
    };
  } else if (paused) {
    state = {
      tone: "paused", eyebrow: "Paused", title: "Queue is on hold",
      detail: `${active} video${active === 1 ? "" : "s"} waiting to be marked`,
      progress: percentage, now: "Nothing will start until you resume", extra: "",
      primary: "Resume queue", action: "resume", secondary: true,
      failView: false, mini: "Resume"
    };
  } else if (counts.running) {
    const runningItem = queue.find((item) => item.status === "running");
    const defaultDuration = `${currentSettings.playbackSeconds || 5}s play`;
    state = {
      tone: "run", eyebrow: "Working", title: "Marking your videos",
      detail: `${counts.completed} of ${total} watched - ${active} still to go`,
      progress: percentage,
      now: runningItem ? (runningItem.title || runningItem.videoId) : "Playing in worker window",
      extra: runningItem && runningItem.workerStatus ? runningItem.workerStatus : defaultDuration,
      primary: "Pause queue", action: "pause", secondary: true,
      failView: false, mini: "Pause"
    };
  } else if (counts.failed && !active) {
    state = {
      tone: "fail", eyebrow: "Needs attention",
      title: `${counts.failed} video${counts.failed === 1 ? "" : "s"} could not play`,
      detail: "Playback did not start in the worker window", progress: percentage,
      now: "Retry them, or remove them from the queue", extra: "",
      primary: "Retry all", action: "retry", secondary: false,
      failView: true, mini: "Retry"
    };
  } else if (active) {
    const backlog = job && Array.isArray(job.videos) && job.videos.length;
    const queued = backlog ? Math.max(0, (job.total || 0) - job.videos.length) : 0;
    const done = backlog ? getPlaylistDoneCount(job, queued) : 0;
    state = {
      tone: backlog ? "run" : "idle",
      eyebrow: backlog ? "Playlist backlog" : "Ready",
      title: backlog ? (job.title || "Playlist") : `${active} video${active === 1 ? "" : "s"} waiting`,
      detail: backlog
        ? `${queued}/${job.total} queued - ${done} done`
        : "The queue will start automatically",
      progress: backlog && job.total ? Math.round((done / job.total) * 100) : percentage,
      now: backlog ? "Remaining videos enter as earlier ones finish" : "",
      extra: "",
      primary: "Pause queue", action: "pause", secondary: true,
      failView: false, mini: "Pause"
    };
  } else {
    state = {
      tone: "idle", eyebrow: "All clear", title: "All caught up",
      detail: `${counts.completed} watched - nothing left to do`, progress: 100,
      now: "", extra: "", primary: "Add videos", action: "add",
      secondary: false, failView: false, mini: "Add"
    };
  }

  hero.dataset.tone = state.tone;
  heroEyebrow.textContent = state.eyebrow;
  miniEyebrow.textContent = state.eyebrow;
  heroTitle.textContent = state.title;
  summary.textContent = state.detail;
  miniDetail.textContent = state.detail;
  heroCount.textContent = total ? `${state.progress}%` : "";
  heroBar.style.width = `${state.progress}%`;
  heroProgress.hidden = !total;
  heroTip.hidden = total !== 0;
  heroNow.hidden = !state.now;
  heroNowText.textContent = state.now;
  heroNowExtra.textContent = state.extra;
  heroPrimary.textContent = state.primary;
  heroPrimary.dataset.action = state.action;
  miniAction.textContent = state.mini;
  miniAction.dataset.action = state.action;
  heroSecondary.hidden = !state.secondary;
  heroFailView.hidden = !state.failView;
}

function handleHeroAction(action) {
  if (action === "pause" || action === "resume") {
    toggleQueuePause().catch(console.error);
  } else if (action === "retry") {
    sendQueueAction("retry-failed").catch(console.error);
  } else if (action === "add") {
    setTab("add");
  }
}

function renderSavedQueueInfo() {
  const limit = Number.isFinite(currentSettings.maxSavedQueueItems)
    ? currentSettings.maxSavedQueueItems
    : 100;
  savedQueueInfo.textContent = limit
    ? `Cap ${limit}: oldest finished removed, active kept (${currentQueue.length} saved). 0 = off.`
    : `Oldest finished are removed above the cap. 0 = keep all (${currentQueue.length} saved).`;
}

function renderQueue(queue, playlistJob = currentPlaylistJob) {
  currentQueue = queue;
  currentPlaylistJob = playlistJob;
  document.body.classList.toggle("debug-visible", debugVisible);

  // Rebuild only rows whose content changed, so scroll position and focus
  // survive the per-second worker status updates. Display newest items first.
  const displayQueue = [...queue].reverse();
  const visibleIds = new Set();

  displayQueue.forEach((item, index) => {
    visibleIds.add(item.id);

    const entry = queueNodes.get(item.id);
    const signature = itemSignature(item);

    if (entry && entry.signature === signature) {
      if (queueList.children[index] !== entry.node) {
        queueList.insertBefore(entry.node, queueList.children[index] || null);
      }
      return;
    }

    const node = createQueueNode(item);
    queueNodes.set(item.id, { node, signature });

    if (entry && queueList.children[index] === entry.node) {
      queueList.replaceChild(node, entry.node);
    } else {
      queueList.insertBefore(node, queueList.children[index] || null);
    }
  });

  for (const [id, entry] of queueNodes) {
    if (!visibleIds.has(id)) {
      entry.node.remove();
      queueNodes.delete(id);
    }
  }

  renderFilterCounts(queue);
  applyFilter();
  renderBulkState(queue);
  renderJobCard(playlistJob);
  renderHero(queue, playlistJob);
  renderSavedQueueInfo();
  const hasActiveBacklog = Boolean(playlistJob && Array.isArray(playlistJob.videos) && playlistJob.videos.length);
  emptyState.hidden = queue.length !== 0;
  clearButton.disabled = queue.length === 0 && !hasActiveBacklog;
  clearAdvanced.disabled = clearButton.disabled;

  if (clearButton.disabled) {
    disarmClear();
  }

  renderPlaylistProgress();
}

function renderBulkState(queue) {
  const counts = getQueueCounts(queue);
  retryFailedButton.disabled = counts.failed === 0;
  clearCompletedButton.disabled = counts.completed === 0;
}

async function loadQueue() {
  const response = await extensionApi.runtime.sendMessage({
    type: "get-queue"
  });

  renderQueue(response.queue || [], response.playlistJob || null);
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
  maxSavedQueueItems.value = Number.isFinite(settings.maxSavedQueueItems)
    ? settings.maxSavedQueueItems
    : 100;
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

async function updateSettings(patch, showSaved = false) {
  const response = await extensionApi.runtime.sendMessage({
    type: "update-settings",
    settings: patch
  });

  applySettings(response.settings || {});
  if (showSaved) {
    savedFlash();
  }
}

async function toggleQueuePause() {
  await updateSettings({
    queuePaused: !currentSettings.queuePaused
  });
  await loadQueue();
}

function stopWorker() {
  return sendQueueAction("stop-worker");
}

async function clearQueue() {
  const response = await extensionApi.runtime.sendMessage({
    type: "clear-queue"
  });

  renderQueue(response.queue || [], null);
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

  // Stop pauses the queue and returns the fresh settings; reflect them so the
  // pause button and summary match the new state without a reopen.
  if (response.settings) {
    applySettings(response.settings);
  }
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

let clearArmed = false;
let clearArmTimer = 0;

function disarmClear() {
  clearArmed = false;
  clearTimeout(clearArmTimer);
  clearButton.textContent = "Clear all";
  clearButton.classList.remove("armed");
}

clearButton.addEventListener("click", () => {
  if (!clearArmed) {
    clearArmed = true;
    clearButton.textContent = "Confirm clear";
    clearButton.classList.add("armed");
    clearTimeout(clearArmTimer);
    clearArmTimer = setTimeout(disarmClear, 3000);
    return;
  }

  disarmClear();
  clearQueue().catch(console.error);
});

optionsToggle.addEventListener("click", () => {
  openDrawer(!drawer.classList.contains("open"));
});
drawerBack.addEventListener("click", () => openDrawer(false));
drawerClose.addEventListener("click", () => openDrawer(false));

advToggle.addEventListener("click", () => {
  const expanded = advToggle.getAttribute("aria-expanded") === "true";
  advToggle.setAttribute("aria-expanded", String(!expanded));
  advBody.classList.toggle("on", !expanded);
});

clearAdvanced.addEventListener("click", () => {
  openDrawer(false);
  clearButton.click();
});

tabQueue.addEventListener("click", () => setTab("queue"));
tabAdd.addEventListener("click", () => setTab("add"));
Array.from(filters.querySelectorAll("[data-filter]")).forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});
heroPrimary.addEventListener("click", () => handleHeroAction(heroPrimary.dataset.action));
heroSecondary.addEventListener("click", () => stopWorker().catch(console.error));
heroFailView.addEventListener("click", () => setFilter("failed"));
miniAction.addEventListener("click", () => handleHeroAction(miniAction.dataset.action));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (drawer.classList.contains("open")) openDrawer(false);
  else if (clearArmed) disarmClear();
});

debugToggle.addEventListener("click", () => {
  debugVisible = !debugVisible;
  debugToggle.setAttribute("aria-pressed", String(debugVisible));
  loadQueue().catch(console.error);
});

workerMode.addEventListener("change", async () => {
  await updateSettings({
    workerMode: workerMode.value
  }, true);
});

playbackSeconds.addEventListener("change", async () => {
  await updateSettings({
    playbackSeconds: playbackSeconds.value
  }, true);
});

seekFromEndSeconds.addEventListener("change", async () => {
  await updateSettings({
    seekFromEndSeconds: seekFromEndSeconds.value
  }, true);
});

maxQueueSize.addEventListener("change", async () => {
  await updateSettings({
    maxQueueSize: maxQueueSize.value
  }, true);
});

maxSavedQueueItems.addEventListener("change", async () => {
  await updateSettings({
    maxSavedQueueItems: maxSavedQueueItems.value
  }, true);
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

markPlaylistButton.addEventListener("click", () => {
  markPlaylistAsWatched().catch(console.error);
});

cancelPlaylistButton.addEventListener("click", () => {
  cancelPlaylistJob().catch(console.error);
});

extensionApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "queue-updated") {
    loadQueue().catch(console.error);
  }

  if (message && message.type === "playlist-scan-progress") {
    setPlaylistStatus(`Loading playlist videos... ${message.scanned} found`);
  }
});

setTab("queue");

loadQueue().catch((error) => {
  console.error(error);
  summary.textContent = "Unable to load queue";
});

loadSettings().catch(console.error);
