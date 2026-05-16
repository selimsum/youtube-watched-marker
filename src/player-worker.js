"use strict";

(() => {
  if (window.__youtubeWatchedMarkerPlayerWorkerLoaded) {
    return;
  }

  window.__youtubeWatchedMarkerPlayerWorkerLoaded = true;

  function getExtensionApi() {
    if (typeof browser !== "undefined") {
      return browser;
    }

    return chrome;
  }

  const extensionApi = getExtensionApi();
  let activeRun = false;
  let runStartedAt = 0;

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function waitForEvent(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`${eventName}-timeout`));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timeoutId);
        target.removeEventListener(eventName, onEvent);
      }

      function onEvent() {
        cleanup();
        resolve();
      }

      target.addEventListener(eventName, onEvent, { once: true });
    });
  }

  async function waitForVideo(timeoutMs, itemId) {
    const startedAt = Date.now();
    let focusRequested = false;

    while (Date.now() - startedAt < timeoutMs) {
      const video = document.querySelector("video");

      if (video) {
        return video;
      }

      if (!focusRequested && Date.now() - startedAt > 5000) {
        focusRequested = true;
        await reportStatus(itemId, "video-not-found-hidden-only");
      }

      await delay(250);
    }

    throw new Error(`video-not-found-${getPageSnapshot()}`);
  }

  async function waitForDuration(video, timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        return video.duration;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        await delay(250);
      } else {
        await Promise.race([
          waitForEvent(video, "loadedmetadata", 1000),
          delay(1000)
        ]).catch(() => {});
      }
    }

    throw new Error("duration-not-found");
  }

  function prepareVideoForMutedAutoplay(video) {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");
    video.setAttribute("playsinline", "");
  }

  async function seekVideo(video, seekTime) {
    video.currentTime = seekTime;

    await Promise.race([
      waitForEvent(video, "seeked", 5000),
      delay(5000)
    ]).catch(() => {});
  }

  async function waitForPlayableVideo(currentVideo, timeoutMs, itemId) {
    const startedAt = Date.now();
    let video = currentVideo;

    while (Date.now() - startedAt < timeoutMs) {
      const latestVideo = document.querySelector("video");
      if (latestVideo && latestVideo !== video) {
        video = latestVideo;
        prepareVideoForMutedAutoplay(video);
        await reportStatus(itemId, "video-element-refreshed");
      }

      if (
        video &&
        video.networkState !== HTMLMediaElement.NETWORK_EMPTY &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return video;
      }

      if (video && video.networkState === HTMLMediaElement.NETWORK_EMPTY) {
        video.load();
      }

      await delay(250);
    }

    throw new Error(`video-not-playable-${getPlaybackSnapshot(video || currentVideo)}`);
  }

  async function startPlayback(video, timeoutMs) {
    let playPromise;

    try {
      playPromise = video.play();
    } catch (error) {
      return {
        ok: false,
        error: `play-threw-${error && error.name ? error.name : "error"}`
      };
    }

    if (playPromise && typeof playPromise.then === "function") {
      try {
        return await Promise.race([
          playPromise.then(() => ({ ok: true })),
          delay(timeoutMs).then(() => ({
            ok: false,
            error: "play-start-timeout"
          }))
        ]);
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : "play-rejected"
        };
      }
    }

    return {
      ok: true
    };
  }

  async function waitForPlaybackProgress(video, timeoutMs) {
    const startedAt = Date.now();
    const initialTime = video.currentTime;

    while (Date.now() - startedAt < timeoutMs) {
      if (!video.paused && video.currentTime > initialTime + 0.25) {
        return true;
      }

      await delay(250);
    }

    return false;
  }

  function getPlayerElement() {
    return document.querySelector(".html5-video-player");
  }

  function getPageSnapshot() {
    const player = getPlayerElement();
    const title = document.title ? document.title.slice(0, 40).replace(/\s+/g, "-") : "no-title";

    return [
      `ready-${document.readyState}`,
      `url-${location.pathname}`,
      player ? "player-yes" : "player-no",
      `title-${title}`
    ].join("_");
  }

  function getVideoTitle() {
    const title = document.querySelector("h1 yt-formatted-string, h1.title, meta[property='og:title']");
    const value = title && (title.getAttribute("content") || title.textContent);
    return (value || document.title || "").replace(/ - YouTube$/, "").replace(/\s+/g, " ").trim();
  }

  function isAdShowing() {
    const player = getPlayerElement();
    return Boolean(player && player.classList.contains("ad-showing"));
  }

  async function handleAdIfPresent(itemId, timeoutMs) {
    if (!isAdShowing()) {
      return;
    }

    await reportStatus(itemId, "ad-showing");
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs && isAdShowing()) {
      const skipButton = document.querySelector([
        ".ytp-ad-skip-button-modern",
        ".ytp-ad-skip-button",
        ".ytp-skip-ad-button",
        ".ytp-ad-overlay-close-button"
      ].join(","));

      if (skipButton) {
        clickElement(skipButton);
        await reportStatus(itemId, "clicked-ad-skip");
      }

      await delay(1000);
    }

    if (isAdShowing()) {
      await reportStatus(itemId, "ad-still-showing");
    }
  }

  function getPlaybackSnapshot(video) {
    return [
      `paused-${video.paused}`,
      `ready-${video.readyState}`,
      `network-${video.networkState}`,
      `time-${Math.round(video.currentTime)}`,
      isAdShowing() ? "ad-yes" : "ad-no"
    ].join("_");
  }

  function createPlaybackAssistError(video) {
    const snapshot = getPlaybackSnapshot(video);

    if (video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      return new Error(`foreground-assist-playback-blocked-${snapshot}`);
    }

    return new Error(`foreground-assist-playback-did-not-advance-${snapshot}`);
  }

  async function requestFocusAssist() {
    try {
      await extensionApi.runtime.sendMessage({
        type: "focus-worker-tab"
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clickElement(element) {
    if (!element) {
      return false;
    }

    element.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    element.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));

    return true;
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || "1") > 0
    );
  }

  function isPlayButton(element) {
    if (!element || !isVisible(element)) {
      return false;
    }

    const label = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ").toLowerCase();

    return !label || /\bplay\b/.test(label);
  }

  async function clickYouTubePlayControls(video, itemId) {
    const candidates = [
      {
        name: "large-play-button",
        element: document.querySelector(".ytp-large-play-button")
      },
      {
        name: "play-button",
        element: document.querySelector(".ytp-play-button")
      }
    ];

    for (const candidate of candidates) {
      if (!isPlayButton(candidate.element)) {
        continue;
      }

      if (clickElement(candidate.element)) {
        await reportStatus(itemId, `clicked-${candidate.name}`);

        if (await waitForPlaybackProgress(video, 1200)) {
          return true;
        }
      }
    }

    return false;
  }

  async function releaseFocusAssist() {
    try {
      await extensionApi.runtime.sendMessage({
        type: "release-worker-tab"
      });
    } catch (_error) {
      // The worker tab may be closing.
    }
  }

  function stopAllVideos() {
    for (const video of document.querySelectorAll("video")) {
      try {
        video.pause();
        video.autoplay = false;
        video.removeAttribute("autoplay");
      } catch (_error) {
        // Best effort cleanup before the worker tab closes.
      }
    }
  }

  async function reportStatus(itemId, status) {
    if (!itemId) {
      return;
    }

    try {
      await extensionApi.runtime.sendMessage({
        type: "worker-status",
        itemId,
        status,
        elapsedMs: runStartedAt ? Date.now() - runStartedAt : null
      });
    } catch (_error) {
      // Status messages are diagnostic only.
    }
  }

  async function playMuted(video, playbackSeconds, itemId) {
    prepareVideoForMutedAutoplay(video);
    await handleAdIfPresent(itemId, 15000);

    const focused = await requestFocusAssist();
    await reportStatus(itemId, focused ? "foreground-assist-started" : "foreground-assist-failed");
    await reportStatus(itemId, "starting-playback-focused");
    const focusedStart = await startPlayback(video, 5000);

    if (!focusedStart.ok) {
      await reportStatus(itemId, focusedStart.error || "focused-play-start-blocked");
    }

    if (!await waitForPlaybackProgress(video, 1500)) {
      await reportStatus(itemId, "clicking-youtube-play-controls-focused");
      const clickStartedPlayback = await clickYouTubePlayControls(video, itemId);

      if (!clickStartedPlayback) {
        await reportStatus(itemId, "play-controls-did-not-start");
      }
    }

    if (!await waitForPlaybackProgress(video, 2500)) {
      await reportStatus(itemId, "retrying-focused-playback");
      const clickedStart = await startPlayback(video, 3000);
      if (!clickedStart.ok) {
        await reportStatus(itemId, clickedStart.error || "retry-play-start-blocked");
      }
    }

    if (!await waitForPlaybackProgress(video, 8000)) {
        await releaseFocusAssist();
        throw createPlaybackAssistError(video);
    }

    await reportStatus(itemId, "foreground-playback-confirmed");
    await reportStatus(itemId, "foreground-assist-releasing");
    await releaseFocusAssist();
    await reportStatus(itemId, "playback-advancing");
    const startedAt = Date.now();

    while (Date.now() - startedAt < playbackSeconds * 1000) {
      if (video.paused) {
        const restart = await startPlayback(video, 2500);

        if (!restart.ok) {
          await clickYouTubePlayControls(video, itemId);
        }
      }

      await delay(500);
    }

    video.pause();
    await releaseFocusAssist();

    return "foreground-assisted";
  }

  async function runWatchSimulation(options) {
    const playbackSeconds = options.playbackSeconds || 10;
    const seekFromEndSeconds = options.seekFromEndSeconds || 60;
    const itemId = options.itemId;
    await reportStatus(itemId, "waiting-for-video");
    let video = await waitForVideo(45000, itemId);
    await reportStatus(itemId, "waiting-for-duration");
    const duration = await waitForDuration(video, 30000);
    const seekTime = Math.max(0, duration - seekFromEndSeconds);

    await reportStatus(itemId, "seeking");
    await seekVideo(video, seekTime);
    await reportStatus(itemId, "waiting-for-playable-video");
    video = await waitForPlayableVideo(video, 15000, itemId);
    const playbackMode = await playMuted(video, playbackSeconds, itemId);
    await reportStatus(itemId, "completed-playback");

    return {
      ok: true,
      playbackSeconds,
      playbackMode,
      title: getVideoTitle(),
      seekTime,
      duration
    };
  }

  async function reportResult(itemId, result) {
    await extensionApi.runtime.sendMessage({
      type: "worker-result",
      itemId,
      result
    });
  }

  extensionApi.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "start-watch-simulation") {
      if (message && message.type === "stop-watch-simulation") {
        stopAllVideos();
        releaseFocusAssist().catch(() => {});
        activeRun = false;
        runStartedAt = 0;
        return Promise.resolve({
          ok: true
        });
      }

      return undefined;
    }

    if (activeRun) {
      return Promise.resolve({
        ok: false,
        error: "worker-already-running"
      });
    }

    activeRun = true;
    runStartedAt = Date.now();

    runWatchSimulation(message)
      .then((result) => reportResult(message.itemId, result))
      .catch(async (error) => {
        await releaseFocusAssist();
        await reportResult(message.itemId, {
          ok: false,
          error: error && error.message ? error.message : String(error)
        });
      })
      .finally(() => {
        activeRun = false;
        runStartedAt = 0;
      });

    return Promise.resolve({
      ok: true
    });
  });
})();
