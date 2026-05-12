"use strict";

const MENU_ITEM_CLASS = "youtube-watched-marker-menu-item";
const MENU_ITEM_SELECTOR = `.${MENU_ITEM_CLASS}`;
const MENU_LIST_MARKER = "youtubeWatchedMarkerInjected";
const HIDDEN_ITEM_CLASS = "youtube-watched-marker-hidden-native-item";
let scanTimer = null;
let lastMenuVideoUrl = null;
let lastMenuVideoTitle = "";

function getExtensionApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }

  return chrome;
}

const extensionApi = getExtensionApi();

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
    "yt-formatted-string#video-title",
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

function createMenuItem() {
  const item = document.createElement("button");
  item.type = "button";
  item.className = MENU_ITEM_CLASS;
  item.setAttribute("role", "menuitem");

  const icon = document.createElement("span");
  icon.className = "youtube-watched-marker-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "+";

  const label = document.createElement("span");
  label.className = "youtube-watched-marker-label";
  label.textContent = "Mark as watched";

  item.append(icon, label);

  const handleClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const url = lastMenuVideoUrl || getFallbackVideoUrl();
    const title = lastMenuVideoTitle || document.title.replace(/ - YouTube$/, "").trim();

    if (!url) {
      setMenuItemText(item, "No video found");
      return;
    }

    setMenuItemText(item, "Adding...");

    try {
      const response = await extensionApi.runtime.sendMessage({
        type: "enqueue-video-url",
        url,
        title
      });

      if (response && response.ok === false) {
        setMenuItemText(item, response.error === "queue-limit-reached"
          ? `Queue limit ${response.maxQueueSize}`
          : "Could not add video");
        return;
      }

      setMenuItemText(item, response && response.created
        ? "Added to watch queue"
        : "Already in watch queue");
      closeYouTubeMenu(item);
    } catch (error) {
      console.error(error);
      setMenuItemText(item, "Could not add video");
    }
  };

  item.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  item.addEventListener("click", handleClick);

  return item;
}

function closeYouTubeMenu(item) {
  const menu = item.closest("ytd-menu-popup-renderer, tp-yt-paper-listbox, tp-yt-iron-dropdown, ytd-popup-container");
  const list = item.parentElement;
  const escapeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true
  });

  if (list && list.dataset) {
    delete list.dataset[MENU_LIST_MARKER];
  }

  restoreHiddenNativeItem(list);
  item.remove();

  window.dispatchEvent(escapeEvent);
  document.documentElement.dispatchEvent(escapeEvent);
  document.dispatchEvent(escapeEvent);

  if (menu && menu.parentElement) {
    menu.parentElement.dispatchEvent(escapeEvent);
  }

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

  if (!list || list.dataset[MENU_LIST_MARKER] === "true") {
    return;
  }

  const popupRoot = list.closest("ytd-menu-popup-renderer, ytd-popup-container, tp-yt-iron-dropdown") || list;

  if (popupRoot.querySelector(MENU_ITEM_SELECTOR)) {
    list.dataset[MENU_LIST_MARKER] = "true";
    return;
  }

  const item = createMenuItem();
  styleMenuItem(item);
  constrainMenuOverflow(list);
  list.dataset[MENU_LIST_MARKER] = "true";
  list.append(item);
  compensateVerticalOverflow(list);
}

function constrainMenuOverflow(list) {
  const containers = [
    list,
    list.closest("ytd-menu-popup-renderer"),
    list.closest("tp-yt-paper-listbox"),
    list.closest("tp-yt-iron-dropdown"),
    list.closest("ytd-popup-container")
  ].filter(Boolean);

  for (const container of containers) {
    container.style.overflowX = "hidden";
    container.style.maxWidth = "100%";
    container.style.boxSizing = "border-box";
  }
}

function compensateVerticalOverflow(list) {
  const container = list.closest("ytd-menu-popup-renderer, tp-yt-iron-dropdown, ytd-popup-container") || list;

  requestAnimationFrame(() => {
    if (!isVerticallyOverflowing(list) && !isVerticallyOverflowing(container)) {
      return;
    }

    const nativeItems = Array.from(list.children).filter((child) => (
      child.nodeType === Node.ELEMENT_NODE &&
      !child.matches(MENU_ITEM_SELECTOR) &&
      !child.classList.contains(HIDDEN_ITEM_CLASS) &&
      child.getBoundingClientRect().height > 0
    ));
    const itemToHide = nativeItems[nativeItems.length - 1];

    if (!itemToHide) {
      return;
    }

    itemToHide.classList.add(HIDDEN_ITEM_CLASS);
    itemToHide.dataset.youtubeWatchedMarkerPreviousDisplay = itemToHide.style.display || "";
    itemToHide.style.display = "none";
  });
}

function isVerticallyOverflowing(element) {
  return Boolean(element && element.scrollHeight > element.clientHeight + 1);
}

function restoreHiddenNativeItem(list) {
  if (!list) {
    return;
  }

  const hiddenItem = list.querySelector(`.${HIDDEN_ITEM_CLASS}`);

  if (!hiddenItem) {
    return;
  }

  hiddenItem.style.display = hiddenItem.dataset.youtubeWatchedMarkerPreviousDisplay || "";
  delete hiddenItem.dataset.youtubeWatchedMarkerPreviousDisplay;
  hiddenItem.classList.remove(HIDDEN_ITEM_CLASS);
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
  }, 50);
}

document.addEventListener("pointerdown", rememberMenuTarget, true);
document.addEventListener("mousedown", rememberMenuTarget, true);
document.addEventListener("click", rememberMenuTarget, true);
document.addEventListener("pointerup", () => {
  scheduleMenuScan();
}, true);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      scanMenus(node);
    }
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

scanMenus(document.documentElement);
