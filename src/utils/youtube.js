"use strict";

function isYouTubeHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  );
}

if (typeof module !== "undefined") {
  module.exports = {
    isYouTubeHost
  };
}
