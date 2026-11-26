"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeElement(tagName, id = "") {
  const listeners = new Map();
  const classes = new Set();
  const attrs = new Map();
  const el = {
    tagName: tagName.toUpperCase(),
    id,
    className: "",
    textContent: "",
    title: "",
    value: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: { setProperty() {} },
    children: [],
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name)
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === "object" && n !== null) {
          n.parentNode = el;
          el.children.push(n);
        }
      }
    },
    appendChild(node) {
      el.append(node);
      return node;
    },
    insertBefore(newNode, refNode) {
      const existingIdx = el.children.indexOf(newNode);
      if (existingIdx !== -1) el.children.splice(existingIdx, 1);
      newNode.parentNode = el;
      if (!refNode) {
        el.children.push(newNode);
        return newNode;
      }
      const refIdx = el.children.indexOf(refNode);
      if (refIdx === -1) el.children.push(newNode);
      else el.children.splice(refIdx, 0, newNode);
      return newNode;
    },
    replaceChild(newNode, oldNode) {
      const idx = el.children.indexOf(oldNode);
      newNode.parentNode = el;
      if (idx !== -1) el.children[idx] = newNode;
      return oldNode;
    },
    remove() {
      if (el.parentNode) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx !== -1) el.parentNode.children.splice(idx, 1);
      }
    },
    querySelectorAll() { return []; },
    click() {
      for (const fn of listeners.get("click") || []) fn({ target: el });
    }
  };
  return el;
}

test("popup.html hides panelAdd by default, uses completed filter, and drops action-proxies", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup", "popup.html"), "utf8");
  assert.match(html, /<section class="panel" id="panelAdd"[^>]*\bhidden\b/);
  assert.match(html, /data-filter="completed">Watched/);
  assert.doesNotMatch(html, /action-proxies/);
});

test("popup.js renders newest-first and applies completed filter correctly", () => {
  const root = path.join(__dirname, "..");
  const elements = new Map();
  const filterChips = ["all", "pending", "completed", "failed"].map((f) => {
    const chip = makeElement("button");
    chip.dataset.filter = f;
    return chip;
  });

  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement("div", id));
    return elements.get(id);
  };
  getEl("filters").querySelectorAll = () => filterChips;

  const context = {
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Blob: function () {},
    setTimeout,
    clearTimeout,
    console,
    document: {
      body: makeElement("body"),
      getElementById: getEl,
      createElement: (tag) => makeElement(tag),
      createElementNS: (_ns, tag) => makeElement(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      addEventListener() {}
    },
    browser: {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === "get-queue") return { queue: [], playlistJob: null };
          if (msg.type === "get-settings") return { settings: {} };
          return { ok: true };
        },
        onMessage: { addListener() {} }
      }
    }
  };

  vm.createContext(context);
  for (const file of ["src/utils/extension.js", "src/utils/youtube.js", "src/delay.js", "popup/popup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }

  context.renderQueue([
    { id: "old", videoId: "11111111111", title: "Older Video", status: "completed", createdAt: "2026-01-01T00:00:00Z" },
    { id: "new", videoId: "22222222222", title: "Newer Video", status: "pending", createdAt: "2026-01-02T00:00:00Z" }
  ], null);

  const queueList = getEl("queueList");
  assert.equal(queueList.children.length, 2);
  assert.equal(queueList.children[0].dataset.status, "pending", "newest item should render first");
  assert.equal(queueList.children[1].dataset.status, "completed");

  context.setFilter("completed");
  assert.equal(queueList.children[0].hidden, true);
  assert.equal(queueList.children[1].hidden, false);
  assert.equal(getEl("filterEmpty").hidden, true);
});
