"use strict";

const CHANNEL_SCAN_MAX_SCROLLS = 120;
const CHANNEL_SCAN_STABLE_SCROLLS = 4;
const CHANNEL_SCAN_RECENT_OLDER_COUNT = 8;
const PLAYLIST_SCAN_MAX_SCROLLS = 200;
const PLAYLIST_SCAN_STABLE_SCROLLS = 5;
const PLAYLIST_SCAN_SCROLL_DELAY_MS = 900;
const PLAYLIST_ROWS_WAIT_ATTEMPTS = 30;
const PLAYLIST_ROWS_WAIT_INTERVAL_MS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

const WATCHED_ITEM_TEXT = 'Mark as watched';
const WATCHED_REMOVE_ITEM_TEXT = 'Mark watched & remove';

// The two labels do not share a substring, so anything that acts on either
// entry has to test both.
function isWatchedItemText(text) {
  return text.includes(WATCHED_ITEM_TEXT) || text.includes(WATCHED_REMOVE_ITEM_TEXT);
}

const CONTAINER_CACHE = new WeakMap();

function getContainerCache(container) {
  let cache = CONTAINER_CACHE.get(container);
  if (!cache) {
    cache = {};
    CONTAINER_CACHE.set(container, cache);
  }
  return cache;
}

const SCAN_CONTAINER_TYPES = [
  "ytd-rich-item-renderer",
  "ytd-rich-grid-media",
  "ytd-rich-grid-slim-media",
  "yt-lockup-view-model",
  "yt-lockup-metadata-view-model",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-reel-item-renderer",
  "ytd-radio-renderer"
];

// Channel scanning skips watch-page and inline-player containers; menu
// targeting still needs them.
const MENU_CONTAINER_SELECTOR = [
  ...SCAN_CONTAINER_TYPES,
  "ytd-channel-video-player-renderer",
  "ytd-watch-flexy"
].join(",");

const SCAN_CONTAINER_SELECTOR = SCAN_CONTAINER_TYPES.join(",");

let workerWindowBounds = null;

function buildWorkerWindowFeatures(bounds) {
  const features = [
    "popup=yes",
    "noopener",
    "noreferrer",
    `width=${bounds.width}`,
    `height=${bounds.height}`
  ];

  if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top)) {
    features.push(`left=${bounds.left}`, `top=${bounds.top}`);
  }

  return features.join(",");
}

let lastMenuVideoUrl = null;
let lastMenuVideoTitle = "";
let pendingOpenedWorkerUrl = null;
let canOpenWorkerWindow = true;

const extensionApi = getExtensionApi();

function refreshDirectOpenState() {
  extensionApi.runtime.sendMessage({ type: "get-queue-state" })
    .then(updateDirectOpenState)
    .catch(() => {});
}

function applyWorkerWindowBounds(saved) {
  if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
    workerWindowBounds = {
      left: saved.left,
      top: saved.top,
      width: saved.width || DEFAULT_WORKER_WINDOW_SIZE.width,
      height: saved.height || DEFAULT_WORKER_WINDOW_SIZE.height
    };
    return;
  }

  workerWindowBounds = null;
}

extensionApi.storage.local.get("workerWindowBounds").then((result) => {
  applyWorkerWindowBounds(result.workerWindowBounds);
}).catch(() => {});

// The saved position changes whenever a worker window is closed or the user
// drags one, which is usually after this tab loaded. Without this the
// window.open() fallback keeps aiming at the position from page load.
extensionApi.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.workerWindowBounds) {
    return;
  }

  applyWorkerWindowBounds(changes.workerWindowBounds.newValue);
});

const MONTHS = {
  jan: 0,
  january: 0,
  ocak: 0,
  feb: 1,
  february: 1,
  subat: 1,
  mar: 2,
  march: 2,
  mart: 2,
  apr: 3,
  april: 3,
  nisan: 3,
  may: 4,
  mayis: 4,
  jun: 5,
  june: 5,
  haziran: 5,
  jul: 6,
  july: 6,
  temmuz: 6,
  aug: 7,
  august: 7,
  agustos: 7,
  sep: 8,
  sept: 8,
  september: 8,
  eylul: 8,
  oct: 9,
  october: 9,
  ekim: 9,
  nov: 10,
  november: 10,
  kasim: 10,
  dec: 11,
  december: 11,
  aralik: 11
};

function updateDirectOpenState(state) {
  canOpenWorkerWindow = Boolean(
    state &&
    !state.hasActiveWorker &&
    !state.queuePaused &&
    (
      state.activeCount === 0 ||
      state.waitingForDirectOpen
    )
  );
}

refreshDirectOpenState();

extensionApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "queue-state") {
    updateDirectOpenState(message);
  }

  if (message && message.type === "scan-channel-timeframe") {
    return scanChannelTimeframe(message.range);
  }

  if (message && message.type === "scan-playlist-videos") {
    return scanPlaylistVideos(message.playlistId);
  }
});

function isChannelVideosPage() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const first = parts[0] || "";

  return Boolean(
    parts[parts.length - 1] === "videos" &&
    (
      first.startsWith("@") ||
      ["channel", "c", "user"].includes(first.toLowerCase())
    )
  );
}

async function scanChannelTimeframe(range) {
  if (
    !range ||
    !Number.isFinite(range.startMs) ||
    !Number.isFinite(range.endMs)
  ) {
    return {
      ok: false,
      error: "invalid-date-range"
    };
  }

  if (!isChannelVideosPage()) {
    return {
      ok: false,
      error: "not-channel-videos-page"
    };
  }

  const pageDataDates = getPageDataPublishDateMap();
  const videosById = new Map();
  const unparseableVideoIds = new Set();
  let stableScrolls = 0;
  let previousCount = 0;

  for (let scrollCount = 0; scrollCount < CHANNEL_SCAN_MAX_SCROLLS; scrollCount += 1) {
    collectChannelVideos(videosById, unparseableVideoIds, pageDataDates);

    const seenCount = videosById.size + unparseableVideoIds.size;

    if (seenCount === previousCount) {
      stableScrolls += 1;
    } else {
      stableScrolls = 0;
      previousCount = seenCount;
    }

    if (shouldStopChannelScan(videosById, range.startMs) || stableScrolls >= CHANNEL_SCAN_STABLE_SCROLLS) {
      break;
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "auto"
    });
    await delay(900);
  }

  collectChannelVideos(videosById, unparseableVideoIds, pageDataDates);

  const videos = Array.from(videosById.values());
  const matchedVideos = videos
    .filter((video) => video.publishedMs >= range.startMs && video.publishedMs <= range.endMs)
    .map((video) => ({
      url: video.url,
      title: video.title,
      channelUrl: window.location.href,
      publishedAt: new Date(video.publishedMs).toISOString(),
      dateMatchPrecision: video.dateMatchPrecision
    }));

  return {
    ok: true,
    scanned: videosById.size + unparseableVideoIds.size,
    matched: matchedVideos.length,
    skippedUnparseable: unparseableVideoIds.size,
    videos: matchedVideos
  };
}

function isPlaylistPage() {
  return window.location.pathname.replace(/\/+$/, "") === "/playlist";
}

// The 2025 redesign replaced ytd-playlist-video-list-renderer with
// yt-section-list-renderer, whose continuation items append further
// yt-item-section-renderer siblings. Scope to the section list so later
// continuations stay inside the root and unrelated shelves stay outside it.
function getPlaylistVideoListRoot() {
  const selectors = [
    "ytd-playlist-video-list-renderer",
    "yt-section-list-renderer",
    "ytd-item-section-renderer",
    "yt-item-section-renderer"
  ];

  for (const selector of selectors) {
    const root = document.querySelector(selector);
    if (root) return root;
  }

  return document.documentElement;
}

function findPlaylistTitle() {
  const header = document.querySelector("ytd-playlist-header-renderer");
  const text = getElementTitle(header && header.querySelector("#playlist-name"));

  return text || document.title.replace(/ - YouTube$/, "").trim();
}

function collectPlaylistVideos(videosById) {
  for (const container of getVideoContainers(getPlaylistVideoListRoot())) {
    const url = findVideoUrlInContainer(container);
    const videoId = extractVideoIdFromUrl(url);

    if (!videoId || videosById.has(videoId)) {
      continue;
    }

    videosById.set(videoId, {
      videoId,
      url,
      title: findVideoTitleInContainer(container)
    });
  }
}

// Rows can arrive well after the tab reports "complete", so an empty first pass
// must not be mistaken for a finished scan. Wait for real rows before the
// stable-scroll budget starts counting.
async function waitForPlaylistRows(videosById) {
  for (let attempt = 0; attempt < PLAYLIST_ROWS_WAIT_ATTEMPTS; attempt += 1) {
    collectPlaylistVideos(videosById);

    if (videosById.size) {
      return true;
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "auto"
    });
    await delay(PLAYLIST_ROWS_WAIT_INTERVAL_MS);
  }

  collectPlaylistVideos(videosById);
  return videosById.size > 0;
}

// Playlist rows arrive in continuations of roughly 100, so a long playlist needs
// many scrolls. Collecting into a Map on every pass keeps videos already seen
// even if YouTube later recycles their rows.
async function scanPlaylistVideos(expectedPlaylistId) {
  const playlistId = extractPlaylistIdFromUrl(window.location.href);

  if (!isPlaylistPage() || !playlistId) {
    return {
      ok: false,
      error: "not-playlist-page"
    };
  }

  // The popup may have just navigated this tab; a stale content script from the
  // previous document must not scan the wrong playlist.
  if (expectedPlaylistId && playlistId !== expectedPlaylistId) {
    return {
      ok: false,
      error: "playlist-not-ready"
    };
  }

  const videosById = new Map();

  if (!await waitForPlaylistRows(videosById)) {
    return {
      ok: false,
      error: "playlist-videos-not-loaded",
      playlistId
    };
  }

  let stableScrolls = 0;
  let previousCount = 0;

  for (let scrollCount = 0; scrollCount < PLAYLIST_SCAN_MAX_SCROLLS; scrollCount += 1) {
    collectPlaylistVideos(videosById);

    if (videosById.size === previousCount) {
      stableScrolls += 1;
    } else {
      stableScrolls = 0;
      previousCount = videosById.size;
      extensionApi.runtime.sendMessage({
        type: "playlist-scan-progress",
        playlistId,
        scanned: videosById.size
      }).catch(() => {});
    }

    if (stableScrolls >= PLAYLIST_SCAN_STABLE_SCROLLS) {
      break;
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "auto"
    });
    await delay(PLAYLIST_SCAN_SCROLL_DELAY_MS);
  }

  collectPlaylistVideos(videosById);

  return {
    ok: true,
    playlistId,
    playlistUrl: buildPlaylistUrl(playlistId),
    title: findPlaylistTitle(),
    scanned: videosById.size,
    videos: Array.from(videosById.values())
  };
}

function getChannelVideoGridRoot() {
  const grid = document.querySelector("ytd-rich-grid-renderer");
  if (grid) return grid;

  const section = document.querySelector("ytd-item-section-renderer");
  if (section) return section;

  const primary = document.querySelector("#primary");
  if (primary) return primary;

  return document.documentElement;
}

function collectChannelVideos(videosById, unparseableVideoIds, pageDataDates) {
  const root = getChannelVideoGridRoot();

  for (const container of getVideoContainers(root)) {
    const url = findVideoUrlInContainer(container);
    const videoId = extractVideoIdFromUrl(url);

    if (!videoId || videosById.has(videoId) || unparseableVideoIds.has(videoId)) {
      continue;
    }

    const dateInfo = getPublishDateInfo(container, videoId, pageDataDates);

    if (!dateInfo) {
      unparseableVideoIds.add(videoId);
      continue;
    }

    videosById.set(videoId, {
      videoId,
      url,
      title: findVideoTitleInContainer(container),
      publishedMs: dateInfo.publishedMs,
      dateMatchPrecision: dateInfo.precision
    });
  }
}

function shouldStopChannelScan(videosById, startMs) {
  const datedVideos = Array.from(videosById.values())
    .filter((video) => Number.isFinite(video.publishedMs));

  if (datedVideos.length < CHANNEL_SCAN_RECENT_OLDER_COUNT * 2) {
    return false;
  }

  return datedVideos
    .slice(-CHANNEL_SCAN_RECENT_OLDER_COUNT)
    .every((video) => video.publishedMs < startMs);
}

function getPublishDateInfo(container, videoId, pageDataDates) {
  const dataText = pageDataDates.get(videoId);
  const dataInfo = parsePublishDateText(dataText);

  if (dataInfo) {
    return dataInfo;
  }

  for (const text of getPublishTextCandidates(container)) {
    const info = parsePublishDateText(text);

    if (info) {
      return info;
    }
  }

  return null;
}

const PUBLISH_TEXT_SELECTORS = [
  "#metadata-line span",
  "span.inline-metadata-item",
  "span.yt-core-attributed-string",
  "yt-formatted-string",
  "[aria-label]",
  "[title]"
].join(",");

function getPublishTextCandidates(container) {
  if (!container) {
    return [];
  }

  const cache = getContainerCache(container);
  if (cache.dateCandidates !== undefined) {
    return cache.dateCandidates;
  }

  const candidates = [];

  for (const element of container.querySelectorAll(PUBLISH_TEXT_SELECTORS)) {
    const text = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ");

    if (looksLikePublishDateText(text)) {
      candidates.push(text);
    }
  }

  if (looksLikePublishDateText(container.textContent)) {
    candidates.push(container.textContent);
  }

  cache.dateCandidates = candidates;
  return candidates;
}

function getPageDataPublishDateMap() {
  const map = new Map();

  for (const pageData of getPageInitialDataValues()) {
    collectPublishDatesFromValue(pageData, map, new WeakSet());
  }

  return map;
}

function getPageInitialDataValues() {
  const values = [];

  if (window.ytInitialData) {
    values.push(window.ytInitialData);
  }

  try {
    if (window.wrappedJSObject && window.wrappedJSObject.ytInitialData) {
      values.push(window.wrappedJSObject.ytInitialData);
    }
  } catch {
    // Firefox may block direct access depending on the page object shape.
  }

  const scriptData = getInitialDataFromScripts();

  if (scriptData) {
    values.push(scriptData);
  }

  return values;
}

function getInitialDataFromScripts() {
  for (const script of document.scripts) {
    const text = script.textContent || "";
    const marker = "var ytInitialData =";
    const markerIndex = text.indexOf(marker);

    if (markerIndex < 0) {
      continue;
    }

    const jsonStart = text.indexOf("{", markerIndex + marker.length);
    const jsonEnd = findJsonObjectEnd(text, jsonStart);

    if (jsonStart < 0 || jsonEnd < 0) {
      continue;
    }

    try {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      // Try the next script if YouTube™ changes this wrapper.
    }
  }

  return null;
}

function findJsonObjectEnd(text, startIndex) {
  if (startIndex < 0) {
    return -1;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function collectPublishDatesFromValue(value, map, visited) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (visited.has(value)) {
    return;
  }

  visited.add(value);
  const videoId = typeof value.videoId === "string" ? value.videoId : null;

  if (videoId && !map.has(videoId)) {
    const text = getRendererPublishText(value);

    if (text) {
      map.set(videoId, text);
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectPublishDatesFromValue(child, map, visited);
    }
  }
}

function getRendererPublishText(value) {
  const textObjects = [
    value.publishedTimeText,
    value.upcomingEventData && value.upcomingEventData.startTime,
    value.dateText
  ];

  for (const textObject of textObjects) {
    const text = extractTextValue(textObject);

    if (text) {
      return text;
    }
  }

  return "";
}

function extractTextValue(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value.simpleText === "string") {
    return value.simpleText;
  }

  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => run.text || "").join("");
  }

  return "";
}

function looksLikePublishDateText(text) {
  const normalized = normalizeDateText(text);

  return Boolean(
    normalized &&
    (
      AGO_REGEX.test(normalized) ||
      ONCE_REGEX.test(normalized) ||
      DATE_SLASH_REGEX.test(normalized) ||
      DATE_DASH_REGEX.test(normalized) ||
      Object.keys(MONTHS).some((monthName) => normalized.includes(monthName))
    )
  );
}

function parsePublishDateText(text) {
  const normalized = normalizeDateText(text);

  if (!normalized) {
    return null;
  }

  return parseExactDateText(normalized) || parseRelativeDateText(normalized);
}

const EXACT_DATE_REGEX_1 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const EXACT_DATE_REGEX_2 = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/;
const EXACT_DATE_REGEX_3 = /\b([a-z]+)\s+(\d{1,2})\s+(\d{4})\b/;
const EXACT_DATE_REGEX_4 = /\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/;
const RELATIVE_DATE_REGEX = /\b(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|saniye|saat|gun|hafta|ay|yil)\b/;
const AGO_REGEX = /\bago\b/;
const ONCE_REGEX = /\bonce\b/;
const DATE_SLASH_REGEX = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;
const DATE_DASH_REGEX = /\b\d{4}-\d{1,2}-\d{1,2}\b/;

function normalizeDateText(text) {
  text = String(text || "");
  if (!text) return "";
  text = text.toLowerCase();

  let result = "";
  let lastWasSpace = true;
  for (let i = 0, len = text.length; i < len; i++) {
    let char = text[i];
    let outChar = char;
    switch (char) {
      case " ": case "\t": case "\n": case "\r": case "\u00a0": case ",": case "\u2022":
        outChar = " ";
        break;
      case "\u015f": outChar = "s"; break;
      case "\u0131": outChar = "i"; break;
      case "\u011f": outChar = "g"; break;
      case "\u00fc": outChar = "u"; break;
      case "\u00f6": outChar = "o"; break;
      case "\u00e7": outChar = "c"; break;
    }

    if (outChar === " ") {
      if (!lastWasSpace) {
        result += " ";
        lastWasSpace = true;
      }
    } else {
      result += outChar;
      lastWasSpace = false;
    }
  }

  if (lastWasSpace && result.length > 0) {
    return result.substring(0, result.length - 1);
  }
  return result;
}

function parseExactDateText(text) {
  let match = EXACT_DATE_REGEX_1.exec(text);

  if (match) {
    return makeExactDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = EXACT_DATE_REGEX_2.exec(text);

  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return makeExactDate(year, Number(match[2]), Number(match[1]));
  }

  match = EXACT_DATE_REGEX_3.exec(text);

  if (match && Object.prototype.hasOwnProperty.call(MONTHS, match[1])) {
    return makeExactDate(Number(match[3]), MONTHS[match[1]] + 1, Number(match[2]));
  }

  match = EXACT_DATE_REGEX_4.exec(text);

  if (match && Object.prototype.hasOwnProperty.call(MONTHS, match[2])) {
    return makeExactDate(Number(match[3]), MONTHS[match[2]] + 1, Number(match[1]));
  }

  return null;
}

function makeExactDate(year, month, day) {
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return {
    publishedMs: date.getTime(),
    precision: "exact"
  };
}

function parseRelativeDateText(text) {
  const match = RELATIVE_DATE_REGEX.exec(text);

  if (!match || (!text.includes("ago") && !text.includes("once"))) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = getRelativeUnitDays(unit);

  if (!Number.isFinite(amount) || !multiplier) {
    return null;
  }

  return {
    publishedMs: Date.now() - (amount * multiplier * DAY_MS),
    precision: "approximate"
  };
}

function getRelativeUnitDays(unit) {
  if (["second", "seconds", "minute", "minutes", "hour", "hours", "saniye", "saat"].includes(unit)) {
    return 0.5;
  }

  if (["day", "days", "gun"].includes(unit)) {
    return 1;
  }

  if (["week", "weeks", "hafta"].includes(unit)) {
    return 7;
  }

  if (["month", "months", "ay"].includes(unit)) {
    return 30;
  }

  if (["year", "years", "yil"].includes(unit)) {
    return 365;
  }

  return null;
}

function absoluteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
}

function isVideoUrl(url) {
  return Boolean(
    url &&
    (
      /\/watch\?/.test(url) ||
      /\/shorts\//.test(url) ||
      /\/live\//.test(url)
    )
  );
}

const VIDEO_URL_SELECTORS = [
  "a#thumbnail[href]",
  "a#video-title[href]",
  "a#video-title-link[href]",
  "a.yt-lockup-metadata-view-model__title[href]",
  "a.yt-simple-endpoint[href]",
  "a[href*='watch?v=']",
  "a[href*='/shorts/']",
  "a[href*='/live/']"
];

function findVideoUrlInContainer(container) {
  if (!container) {
    return null;
  }

  const cache = getContainerCache(container);
  if (cache.url !== undefined) {
    return cache.url;
  }

  for (const selector of VIDEO_URL_SELECTORS) {
    const link = container.querySelector(selector);
    const url = absoluteUrl(link && link.getAttribute("href"));

    if (isVideoUrl(url)) {
      cache.url = url;
      return url;
    }
  }

  cache.url = null;
  return null;
}

function getVideoContainer(element) {
  return element && element.closest && element.closest(MENU_CONTAINER_SELECTOR);
}

function getVideoContainers(root) {
  const containers = [];

  if (root.nodeType === Node.ELEMENT_NODE && root.matches(SCAN_CONTAINER_SELECTOR)) {
    containers.push(root);
  }

  if (root.querySelectorAll) {
    for (const container of root.querySelectorAll(SCAN_CONTAINER_SELECTOR)) {
      containers.push(container);
    }
  }

  return containers;
}

function getElementTitle(element) {
  if (!element) {
    return "";
  }

  return (element.getAttribute("title") || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function findVideoTitleInContainer(container) {
  if (!container) {
    return "";
  }

  const cache = getContainerCache(container);
  if (cache.title !== undefined) {
    return cache.title;
  }

  const selectors = [
    "a#video-title",
    "a#video-title-link",
    "a.yt-lockup-metadata-view-model__title",
    "yt-formatted-string#video-title",
    "h3 a",
    "#video-title",
    "h3",
    "h4",
    "[title]"
  ];

  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const text = getElementTitle(element);

    if (text) {
      cache.title = text;
      return text;
    }
  }

  cache.title = "";
  return "";
}

function findVideoUrlFromElement(element) {
  const link = element && element.closest && element.closest("a[href]");
  const linkUrl = absoluteUrl(link && link.getAttribute("href"));

  if (isVideoUrl(linkUrl)) {
    return linkUrl;
  }

  const videoContainer = getVideoContainer(element);

  return findVideoUrlInContainer(videoContainer);
}

function findVideoTitleFromElement(element) {
  const title = findVideoTitleInContainer(getVideoContainer(element));

  if (title) {
    return title;
  }

  return document.title.replace(/ - YouTube$/, "").trim();
}

function findVideoUrlFromEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];

  for (const node of path) {
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      const url = findVideoUrlFromElement(node);

      if (url) {
        return url;
      }
    }
  }

  return findVideoUrlFromElement(event.target);
}

function rememberMenuTarget(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const clickedMenu = path.some((node) => (
    node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (
      node.matches("ytd-menu-renderer") ||
      node.matches("ytd-menu-button-renderer") ||
      node.matches("yt-icon-button") ||
      node.matches("yt-button-shape") ||
      node.matches("button[aria-label]")
    )
  ));

  if (!clickedMenu) {
    return;
  }

  const url = findVideoUrlFromEvent(event);

  if (url) {
    lastMenuVideoUrl = url;
    lastMenuVideoTitle = findVideoTitleFromEvent(event);
  }
}

function findVideoTitleFromEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];

  for (const node of path) {
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      const title = findVideoTitleFromElement(node);

      if (title) {
        return title;
      }
    }
  }

  return findVideoTitleFromElement(event.target);
}

function getFallbackVideoUrl() {
  const currentPageUrl = absoluteUrl(window.location.href);

  if (isVideoUrl(currentPageUrl)) {
    return currentPageUrl;
  }

  return null;
}

function openWorkerWindow(workerUrl) {
  if (!workerUrl) {
    return null;
  }

  try {
    return window.open(
      workerUrl,
      "ytwm-worker",
      buildWorkerWindowFeatures(workerWindowBounds || DEFAULT_WORKER_WINDOW_SIZE)
    );
  } catch {
    return null;
  }
}

async function enqueueDirectOpen(url, title) {
  const workerUrl = buildWorkerUrl(url);
  const preopened = Boolean(workerUrl) && pendingOpenedWorkerUrl === workerUrl;
  let openedWorkerWindow = null;

  if (!preopened && canOpenWorkerWindow) {
    openedWorkerWindow = openWorkerWindow(workerUrl);

    if (openedWorkerWindow) {
      canOpenWorkerWindow = false;
    }
  }

  pendingOpenedWorkerUrl = null;

  if (!preopened && !openedWorkerWindow && canOpenWorkerWindow) {
    throw new Error("worker-window-blocked");
  }

  const response = await extensionApi.runtime.sendMessage({
    type: preopened || openedWorkerWindow
      ? "enqueue-video-url-with-opened-worker"
      : "enqueue-video-url",
    url,
    title,
    workerUrl,
    openedWorkerUrl: workerUrl
  });

  // The background owns any window it preopened and closes it itself. It only
  // asks us to close a window this script opened directly.
  if (openedWorkerWindow && response && response.closeOpenedWorker) {
    openedWorkerWindow.close();
  }

  if (response && response.ok === false) {
    refreshDirectOpenState();
    throw new Error(response.error || "enqueue-failed");
  }

  if (response && response.created) {
    canOpenWorkerWindow = false;
  }

  return response;
}

function closeYouTubeMenu() {
  const escapeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true
  });

  window.dispatchEvent(escapeEvent);
  document.documentElement.dispatchEvent(escapeEvent);
  document.dispatchEvent(escapeEvent);

  requestAnimationFrame(() => {
    document.body.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}

function getWatchedTarget() {
  const url = lastMenuVideoUrl || getFallbackVideoUrl();

  if (!url) {
    return null;
  }

  return {
    url,
    title: lastMenuVideoTitle || document.title.replace(/ - YouTube$/, "").trim()
  };
}

// The playlist item carries YouTube's own remove-from-playlist command, so its
// click has to keep travelling into the page: closing the menu here would drop
// that command before YouTube runs it.
function handleWatchedClick(leaveMenuOpen) {
  const target = getWatchedTarget();

  if (target) {
    enqueueDirectOpen(target.url, target.title).catch(console.error);
  }

  if (!leaveMenuOpen) {
    closeYouTubeMenu();
  }
}

document.addEventListener("pointerdown", rememberMenuTarget, true);
document.addEventListener("click", rememberMenuTarget, true);

// Capture-phase detection works inside YouTube's shadow DOMs.
// We avoid window.open() (blocked from capture handlers in FF content scripts)
// by telling the background to create the worker window via windows.create().
document.addEventListener('pointerdown', (e) => {
  const item = e.target.closest('ytd-menu-service-item-renderer, yt-list-item-view-model');
  if (!item) return;
  if (!isWatchedItemText(item.textContent)) return;
  if (!canOpenWorkerWindow) return;
  const url = lastMenuVideoUrl || getFallbackVideoUrl();
  if (!url) return;
  const workerUrl = buildWorkerUrl(url);
  if (!workerUrl || pendingOpenedWorkerUrl) return;
  pendingOpenedWorkerUrl = workerUrl;
  canOpenWorkerWindow = false;
  extensionApi.runtime.sendMessage({
    type: "preopen-worker",
    workerUrl
  }).catch(() => {});
}, true);

document.addEventListener('click', (e) => {
  const item = e.target.closest('ytd-menu-service-item-renderer, yt-list-item-view-model');
  if (!item) return;
  if (item.textContent.includes(WATCHED_REMOVE_ITEM_TEXT)) {
    handleWatchedClick(true);
    return;
  }
  if (item.textContent.includes(WATCHED_ITEM_TEXT)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handleWatchedClick(false);
  }
}, true);
