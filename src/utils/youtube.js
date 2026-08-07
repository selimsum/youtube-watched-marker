"use strict";

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const DEFAULT_WORKER_WINDOW_BOUNDS = {
  left: 2176,
  top: 144,
  width: 1280,
  height: 720
};

function isYouTubeHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  );
}

function normalizeUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
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

function getVideoIdFromUrl(rawUrl) {
  return extractVideoIdFromUrl(rawUrl);
}

function buildWatchUrl(videoId) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  url.searchParams.set("ytwm_worker", "1");
  url.searchParams.set("mute", "1");
  url.searchParams.set("autoplay", "1");
  return url.toString();
}

function buildWorkerUrl(rawUrl) {
  const videoId = extractVideoIdFromUrl(rawUrl);
  return videoId ? buildWatchUrl(videoId) : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_WORKER_WINDOW_BOUNDS,
    buildWatchUrl,
    buildWorkerUrl,
    cleanVideoId,
    extractVideoIdFromUrl,
    getVideoIdFromUrl,
    isYouTubeHost,
    normalizeUrl
  };
}
