"use strict";

const DEFAULT_WORKER_WINDOW_BOUNDS = {
  left: 2176,
  top: 144,
  width: 1280,
  height: 720
};
const CHANNEL_SCAN_MAX_SCROLLS = 120;
const CHANNEL_SCAN_STABLE_SCROLLS = 4;
const CHANNEL_SCAN_RECENT_OLDER_COUNT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// Widen contextual sheets to prevent text wrapping (bokblock interaction)
(function() {
  var s = document.createElement('script');
  s.textContent = 'window.__ytwmSheetWidth=function(w){var st=document.getElementById("ytwm-sheet-style")||document.createElement("style");st.id="ytwm-sheet-style";st.textContent=w?"tp-yt-iron-dropdown{min-width:"+w+"px!important;width:auto!important}yt-sheet-view-model{min-width:"+w+"px!important;width:auto!important}yt-contextual-sheet-layout{min-width:"+w+"px!important;width:auto!important}yt-contextual-sheet-layout yt-list-view-model{min-width:"+(w-10)+"px!important}yt-contextual-sheet-layout yt-list-item-view-model{min-width:"+(w-10)+"px!important}":"";if(w){document.documentElement.appendChild(st)}else{st.remove()}};window.__ytwmSheetWidth(240)';
  document.documentElement.appendChild(s);
  s.remove();
})();

const WATCHED_ITEM_TEXT = 'Mark as watched';

const CONTAINER_CACHE = new WeakMap();

function getContainerCache(container) {
  let cache = CONTAINER_CACHE.get(container);
  if (!cache) {
    cache = {};
    CONTAINER_CACHE.set(container, cache);
  }
  return cache;
}

const VIDEO_CONTAINER_SELECTOR = [
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
  "ytd-radio-renderer",
  "ytd-channel-video-player-renderer",
  "ytd-watch-flexy"
].join(",");

const VIDEO_CONTAINERS_SELECTOR = [
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
].join(",");

let workerWindowBounds = { ...DEFAULT_WORKER_WINDOW_BOUNDS };

function buildWorkerWindowFeatures(bounds) {
  return [
    "popup=yes",
    "noopener",
    "noreferrer",
    `left=${bounds.left}`,
    `top=${bounds.top}`,
    `width=${bounds.width}`,
    `height=${bounds.height}`
  ].join(",");
}

let lastMenuVideoUrl = null;
let lastMenuVideoTitle = "";
let pendingOpenedWorkerWindow = null;
let pendingOpenedWorkerUrl = null;
let canOpenWorkerWindow = true;

const extensionApi = getExtensionApi();

extensionApi.storage.local.get("workerWindowBounds").then((result) => {
  const saved = result.workerWindowBounds;
  if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
    workerWindowBounds = {
      left: saved.left,
      top: saved.top,
      width: saved.width || DEFAULT_WORKER_WINDOW_BOUNDS.width,
      height: saved.height || DEFAULT_WORKER_WINDOW_BOUNDS.height
    };
  }
}).catch(() => {});

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

extensionApi.runtime.sendMessage({ type: "get-queue-state" })
  .then(updateDirectOpenState)
  .catch(() => {});

extensionApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "queue-state") {
    updateDirectOpenState(message);
  }

  if (message && message.type === "scan-channel-timeframe") {
    return scanChannelTimeframe(message.range);
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

function collectChannelVideos(videosById, unparseableVideoIds, pageDataDates) {
  for (const container of getVideoContainers(document.documentElement)) {
    const url = findVideoUrlInContainer(container);
    const videoId = getVideoIdFromUrl(url);

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
  "a[href*='/watch?v=']",
  "a[href^='/shorts/']",
  "a[href*='/shorts/']",
  "a[href^='/live/']",
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
  return element && element.closest && element.closest(VIDEO_CONTAINER_SELECTOR);
}

function getVideoContainers(root) {
  const containers = [];

  if (root.nodeType === Node.ELEMENT_NODE && root.matches(VIDEO_CONTAINERS_SELECTOR)) {
    containers.push(root);
  }

  if (root.querySelectorAll) {
    for (const container of root.querySelectorAll(VIDEO_CONTAINERS_SELECTOR)) {
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

function getVideoIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const watchId = url.searchParams.get("v");

    if (watchId) {
      return watchId;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0])) {
      return parts[1] || null;
    }
  } catch {}

  return null;
}

function buildWorkerUrl(rawUrl) {
  const videoId = getVideoIdFromUrl(rawUrl);

  if (!videoId) {
    return null;
  }

  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  url.searchParams.set("ytwm_worker", "1");
  return url.toString();
}

function openWorkerWindow(workerUrl) {
  if (!workerUrl) {
    return null;
  }

  try {
    return window.open(workerUrl, `ytwm-worker-${Date.now()}`, buildWorkerWindowFeatures(workerWindowBounds));
  } catch {
    return null;
  }
}

async function enqueueDirectOpen(url, title) {
  const workerUrl = buildWorkerUrl(url);
  let openedWorkerWindow = pendingOpenedWorkerUrl === workerUrl
    ? pendingOpenedWorkerWindow
    : null;

  if (!openedWorkerWindow && canOpenWorkerWindow) {
    openedWorkerWindow = openWorkerWindow(workerUrl);
    if (openedWorkerWindow) {
      canOpenWorkerWindow = false;
    }
  }

  pendingOpenedWorkerWindow = null;
  pendingOpenedWorkerUrl = null;

  if (!openedWorkerWindow && canOpenWorkerWindow) {
    throw new Error("worker-window-blocked");
  }

  const response = await extensionApi.runtime.sendMessage({
    type: openedWorkerWindow ? "enqueue-video-url-with-opened-worker" : "enqueue-video-url",
    url,
    title,
    workerUrl,
    openedWorkerUrl: workerUrl
  });

  if (response && response.ok === false) {
    if (openedWorkerWindow) {
      openedWorkerWindow.close();
    }
    extensionApi.runtime.sendMessage({ type: "get-queue-state" })
      .then(updateDirectOpenState)
      .catch(() => {});
    throw new Error(response.error || "enqueue-failed");
  }

  if (response && response.created) {
    canOpenWorkerWindow = false;
  }

  if (openedWorkerWindow && response && !response.created) {
    openedWorkerWindow.close();
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

function handleWatchedClick() {
  const url = lastMenuVideoUrl || getFallbackVideoUrl();
  const title = lastMenuVideoTitle || document.title.replace(/ - YouTube$/, "").trim();
  if (!url) {
    closeYouTubeMenu();
    return;
  }
  enqueueDirectOpen(url, title).catch(console.error);
  closeYouTubeMenu();
}

document.addEventListener("pointerdown", rememberMenuTarget, true);
document.addEventListener("mousedown", rememberMenuTarget, true);
document.addEventListener("click", rememberMenuTarget, true);

// Capture-phase detection works inside YouTube's shadow DOMs.
// We avoid window.open() (blocked from capture handlers in FF content scripts)
// by telling the background to create the worker window via windows.create().
document.addEventListener('pointerdown', (e) => {
  const item = e.target.closest('ytd-menu-service-item-renderer, yt-list-item-view-model');
  if (!item) return;
  if (!item.textContent.includes(WATCHED_ITEM_TEXT)) return;
  if (!canOpenWorkerWindow) return;
  const url = lastMenuVideoUrl || getFallbackVideoUrl();
  if (!url) return;
  const workerUrl = buildWorkerUrl(url);
  if (!workerUrl || pendingOpenedWorkerWindow) return;
  pendingOpenedWorkerUrl = workerUrl;
  pendingOpenedWorkerWindow = {}; // dummy truthy — background handles the actual window
  canOpenWorkerWindow = false;
  extensionApi.runtime.sendMessage({
    type: "preopen-worker",
    workerUrl
  }).catch(() => {});
}, true);

document.addEventListener('click', (e) => {
  const item = e.target.closest('ytd-menu-service-item-renderer, yt-list-item-view-model');
  if (!item) return;
  if (item.textContent.includes(WATCHED_ITEM_TEXT)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handleWatchedClick();
  }
}, true);
