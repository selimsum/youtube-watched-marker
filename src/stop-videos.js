"use strict";

for (const video of document.querySelectorAll("video")) {
  try {
    video.pause();
    // Assigning currentTime (even to itself) runs the seek algorithm, which
    // interrupts in-flight buffering so playback cannot resume after pause().
    video.currentTime = video.currentTime;
  } catch {}
}
