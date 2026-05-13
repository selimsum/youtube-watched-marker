"use strict";

const MENU_ITEM_CLASS = "youtube-watched-marker-menu-item";
const MENU_ITEM_SELECTOR = `.${MENU_ITEM_CLASS}`;
const CARD_BUTTON_CLASS = "youtube-watched-marker-card-button";
const CARD_BUTTON_SELECTOR = `.${CARD_BUTTON_CLASS}`;
const MENU_ITEM_HOVER_BACKGROUND = "var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.06))";
const WORKER_WINDOW_BOUNDS = {
  left: 2176,
  top: 144,
  width: 1280,
  height: 720
};
let scanTimer = null;
let lastMenuVideoUrl = null;
let lastMenuVideoTitle = "";
let pendingOpenedWorkerWindow = null;
let pendingOpenedWorkerUrl = null;
let canOpenWorkerWindow = true;
let overlayMenuItem = null;

function getExtensionApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }

  return chrome;
}

const extensionApi = getExtensionApi();

function updateDirectOpenState(state) {
  canOpenWorkerWindow = Boolean(
    state &&
    state.activeCount === 0 &&
    !state.hasActiveWorker &&
    !state.queuePaused
  );
}

extensionApi.runtime.sendMessage({ type: "get-queue-state" })
  .then(updateDirectOpenState)
  .catch(() => {});

extensionApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "queue-state") {
    updateDirectOpenState(message);
  }
});

function absoluteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, window.location.origin).toString();
  } catch (_error) {
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

function findVideoUrlInContainer(container) {
  if (!container) {
    return null;
  }

  const selectors = [
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

  for (const selector of selectors) {
    const link = container.querySelector(selector);
    const url = absoluteUrl(link && link.getAttribute("href"));

    if (isVideoUrl(url)) {
      return url;
    }
  }

  return null;
}

function getVideoContainer(element) {
  return element && element.closest && element.closest([
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
  ].join(","));
}

function getVideoContainers(root) {
  const selector = [
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

  const containers = [];

  if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
    containers.push(root);
  }

  if (root.querySelectorAll) {
    containers.push(...root.querySelectorAll(selector));
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
    const title = getElementTitle(container.querySelector(selector));

    if (title) {
      return title;
    }
  }

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
  } catch (_error) {}

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

  const features = [
    "popup=yes",
    `left=${WORKER_WINDOW_BOUNDS.left}`,
    `top=${WORKER_WINDOW_BOUNDS.top}`,
    `width=${WORKER_WINDOW_BOUNDS.width}`,
    `height=${WORKER_WINDOW_BOUNDS.height}`
  ].join(",");

  try {
    return window.open(workerUrl, `ytwm-worker-${Date.now()}`, features);
  } catch (_error) {
    return null;
  }
}

async function enqueueDirectOpen(url, title, item) {
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

  if (item) {
    setMenuItemText(item, response && response.created
      ? "Added to watch queue"
      : "Already in watch queue");
  }

  return response;
}

function createMenuItem() {
  const item = document.createElement("button");
  item.type = "button";
  item.className = MENU_ITEM_CLASS;
  item.setAttribute("role", "menuitem");
  item.dataset.youtubeWatchedMarkerBusy = "false";

  const icon = document.createElement("span");
  icon.className = "youtube-watched-marker-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "+";

  const label = document.createElement("span");
  label.className = "youtube-watched-marker-label";
  label.textContent = "Mark as watched";

  item.append(icon, label);

  const activate = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (item.dataset.youtubeWatchedMarkerBusy === "true") {
      return;
    }

    item.dataset.youtubeWatchedMarkerBusy = "true";
    const url = lastMenuVideoUrl || getFallbackVideoUrl();
    const title = lastMenuVideoTitle || document.title.replace(/ - YouTube$/, "").trim();

    if (!url) {
      setMenuItemText(item, "No video found");
      item.dataset.youtubeWatchedMarkerBusy = "false";
      return;
    }

    setMenuItemText(item, pendingOpenedWorkerWindow ? "Adding..." : "Opening...");

    try {
      await enqueueDirectOpen(url, title, item);
      closeYouTubeMenu(item);
    } catch (error) {
      console.error(error);
      setMenuItemText(item, "Could not add video");
      item.dataset.youtubeWatchedMarkerBusy = "false";
    }
  };

  const handlePointerDown = (event) => {
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (item.dataset.youtubeWatchedMarkerBusy === "true") {
      return;
    }

    if (!canOpenWorkerWindow) {
      return;
    }

    const url = lastMenuVideoUrl || getFallbackVideoUrl();
    const workerUrl = buildWorkerUrl(url);

    if (!workerUrl || pendingOpenedWorkerWindow) {
      return;
    }

    pendingOpenedWorkerUrl = workerUrl;
    pendingOpenedWorkerWindow = openWorkerWindow(workerUrl);

    if (pendingOpenedWorkerWindow) {
      canOpenWorkerWindow = false;
    }
  };

  const stopPointerEvent = (event) => {
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  item.addEventListener("pointerdown", handlePointerDown);
  item.addEventListener("mousedown", stopPointerEvent);
  item.addEventListener("mouseup", stopPointerEvent);
  item.addEventListener("pointerup", activate);
  item.addEventListener("pointerenter", () => setMenuItemHover(item, true));
  item.addEventListener("pointerleave", () => setMenuItemHover(item, false));
  item.addEventListener("focus", () => setMenuItemHover(item, true));
  item.addEventListener("blur", () => setMenuItemHover(item, false));
  item.addEventListener("click", activate);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      activate(event).catch(console.error);
    }
  });

  return item;
}

function createCardButton(container) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = CARD_BUTTON_CLASS;
  button.title = "Mark as watched";
  button.setAttribute("aria-label", "Mark as watched");
  button.textContent = "+";

  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!canOpenWorkerWindow || button.dataset.busy === "true") {
      return;
    }

    const url = findVideoUrlInContainer(container);
    const workerUrl = buildWorkerUrl(url);

    if (!workerUrl || pendingOpenedWorkerWindow) {
      return;
    }

    pendingOpenedWorkerUrl = workerUrl;
    pendingOpenedWorkerWindow = openWorkerWindow(workerUrl);

    if (pendingOpenedWorkerWindow) {
      canOpenWorkerWindow = false;
    }
  });

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (button.dataset.busy === "true") {
      return;
    }

    const url = findVideoUrlInContainer(container);
    const title = findVideoTitleInContainer(container);

    if (!url) {
      return;
    }

    button.dataset.busy = "true";
    button.textContent = "...";

    try {
      await enqueueDirectOpen(url, title);
      button.textContent = "✓";
      setTimeout(() => {
        button.textContent = "+";
        button.dataset.busy = "false";
      }, 1200);
    } catch (_error) {
      button.textContent = "!";
      setTimeout(() => {
        button.textContent = "+";
        button.dataset.busy = "false";
      }, 1600);
    }
  });

  return button;
}

function styleCardButton(button) {
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "32px";
  button.style.height = "32px";
  button.style.minWidth = "32px";
  button.style.flex = "0 0 32px";
  button.style.alignSelf = "flex-start";
  button.style.marginInlineStart = "auto";
  button.style.marginInlineEnd = "4px";
  button.style.marginTop = "0";
  button.style.border = "0";
  button.style.borderRadius = "50%";
  button.style.background = "transparent";
  button.style.color = "var(--yt-spec-text-primary, #0f0f0f)";
  button.style.font = "700 22px/1 Roboto, Arial, sans-serif";
  button.style.cursor = "pointer";
}

function injectCardButton(container) {
  if (!findVideoUrlInContainer(container) || container.querySelector(CARD_BUTTON_SELECTOR)) {
    return;
  }

  const menu = container.querySelector([
    "ytd-menu-renderer",
    "ytd-menu-button-renderer",
    "yt-icon-button",
    "yt-button-shape button[aria-label]",
    "button[aria-label*='Action menu']",
    "button[aria-label*='More actions']",
    "button[aria-label*='Diğer']",
    "button[aria-label*='Eylem']",
    "#menu",
    "#menu-button"
  ].join(","));

  if (!menu || !menu.parentElement) {
    return;
  }

  const button = createCardButton(container);
  styleCardButton(button);
  menu.parentElement.style.display = "flex";
  menu.parentElement.style.alignItems = "flex-start";
  menu.parentElement.insertBefore(button, menu);
}

function scanVideoCards(root) {
  for (const container of getVideoContainers(root)) {
    injectCardButton(container);
  }
}

function setMenuItemHover(item, active) {
  item.style.background = active ? MENU_ITEM_HOVER_BACKGROUND : "transparent";
  item.style.opacity = "1";
  item.style.color = "var(--yt-spec-text-primary, #0f0f0f)";

  for (const child of item.children) {
    child.style.opacity = "1";
    child.style.color = "var(--yt-spec-text-primary, #0f0f0f)";
  }
}

function closeYouTubeMenu(item) {
  const escapeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true
  });

  removeOverlayMenuItem();

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

function setMenuItemText(item, text) {
  const label = item.querySelector(".youtube-watched-marker-label") || item;
  label.textContent = text;
}

function styleMenuItem(item) {
  item.style.display = "flex";
  item.style.alignItems = "center";
  item.style.gap = "16px";
  item.style.width = "100%";
  item.style.maxWidth = "100%";
  item.style.minWidth = "0";
  item.style.minHeight = "40px";
  item.style.padding = "0 16px";
  item.style.color = "var(--yt-spec-text-primary, #0f0f0f)";
  item.style.background = "transparent";
  item.style.border = "0";
  item.style.boxSizing = "border-box";
  item.style.cursor = "pointer";
  item.style.font = "400 14px Roboto, Arial, sans-serif";
  item.style.lineHeight = "20px";
  item.style.overflow = "hidden";
  item.style.textAlign = "left";

  const icon = item.querySelector(".youtube-watched-marker-icon");
  if (icon) {
    icon.style.flex = "0 0 24px";
    icon.style.width = "24px";
    icon.style.height = "24px";
    icon.style.lineHeight = "24px";
    icon.style.textAlign = "center";
  }

  const label = item.querySelector(".youtube-watched-marker-label");
  if (label) {
    label.style.display = "inline-block";
    label.style.flex = "1 1 auto";
    label.style.minWidth = "0";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.style.color = "var(--yt-spec-text-primary, #0f0f0f)";
    label.style.whiteSpace = "nowrap";
  }
}

function getMenuList(menu) {
  if (!menu) {
    return null;
  }

  if (menu.matches("tp-yt-paper-listbox, #items, yt-list-view-model")) {
    return menu;
  }

  return menu.querySelector([
    "tp-yt-paper-listbox",
    "#items",
    "ytd-menu-popup-renderer",
    "yt-list-view-model"
  ].join(","));
}

function injectIntoMenu(menu) {
  const list = getMenuList(menu);

  if (!list) {
    return;
  }

  if (!hasNativeMenuItems(list) || !hasUsableMenuTarget()) {
    removeOverlayMenuItem();
    return;
  }

  showOverlayMenuItem(list);
}

function showOverlayMenuItem(list) {
  if (!overlayMenuItem) {
    overlayMenuItem = createMenuItem();
    styleMenuItem(overlayMenuItem);
    overlayMenuItem.style.position = "fixed";
    overlayMenuItem.style.zIndex = "2147483647";
    overlayMenuItem.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.14)";
    overlayMenuItem.style.borderRadius = "12px";
    overlayMenuItem.style.background = "var(--yt-spec-base-background, #fff)";
    document.documentElement.append(overlayMenuItem);
  }

  const rect = list.getBoundingClientRect();
  const height = 48;
  const gap = 6;
  const topBelow = rect.bottom + gap;
  const topAbove = rect.top - height - gap;
  const top = topBelow + height <= window.innerHeight
    ? topBelow
    : Math.max(8, topAbove);

  overlayMenuItem.style.left = `${Math.max(8, rect.left)}px`;
  overlayMenuItem.style.top = `${top}px`;
  overlayMenuItem.style.width = `${Math.max(220, rect.width)}px`;
  overlayMenuItem.style.height = `${height}px`;
}

function removeOverlayMenuItem() {
  if (overlayMenuItem) {
    overlayMenuItem.remove();
    overlayMenuItem = null;
  }
}

function hasNativeMenuItems(list) {
  return Array.from(list.querySelectorAll([
    "[role='menuitem']",
    "ytd-menu-service-item-renderer",
    "ytd-toggle-menu-service-item-renderer",
    "yt-list-item-view-model",
    "button",
    "a"
  ].join(","))).some((child) => (
    !child.matches(MENU_ITEM_SELECTOR) &&
    child.getBoundingClientRect().height > 0
  ));
}

function hasUsableMenuTarget() {
  return Boolean(lastMenuVideoUrl || getFallbackVideoUrl());
}

function scanMenus(root) {
  const menus = [];

  const selector = [
    "ytd-menu-popup-renderer",
    "tp-yt-paper-listbox",
    "tp-yt-iron-dropdown",
    "ytd-popup-container",
    "yt-list-view-model"
  ].join(",");

  if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
    menus.push(root);
  }

  if (root.querySelectorAll) {
    menus.push(...root.querySelectorAll(selector));
  }

  for (const menu of menus) {
    injectIntoMenu(menu);
  }
}

function scheduleMenuScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanMenus(document.documentElement);
    scanVideoCards(document.documentElement);
  }, 50);
}

document.addEventListener("pointerdown", rememberMenuTarget, true);
document.addEventListener("mousedown", rememberMenuTarget, true);
document.addEventListener("click", rememberMenuTarget, true);
document.addEventListener("pointerdown", () => {
  scheduleMenuScan();
}, true);
document.addEventListener("pointerup", () => {
  scheduleMenuScan();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    removeOverlayMenuItem();
  }
}, true);
document.addEventListener("scroll", () => {
  removeOverlayMenuItem();
}, true);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      scanMenus(node);
      scanVideoCards(node);
    }
  }

  if (overlayMenuItem && !document.querySelector("ytd-menu-popup-renderer, tp-yt-paper-listbox, tp-yt-iron-dropdown, ytd-popup-container, yt-list-view-model")) {
    removeOverlayMenuItem();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

scanMenus(document.documentElement);
scanVideoCards(document.documentElement);
