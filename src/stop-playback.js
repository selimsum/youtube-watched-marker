"use strict";

for (const video of document.querySelectorAll("video")) {
  try {
    video.pause();
    video.currentTime = video.currentTime;
  } catch (_error) {
    // Best effort cleanup.
  }
}
