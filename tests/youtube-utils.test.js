"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadYouTubeUtils() {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "utils", "youtube.js"),
    "utf8"
  );
  const context = { URL };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

const utils = loadYouTubeUtils();

test("isYouTubeHost accepts youtube.com subdomains and youtu.be only", () => {
  assert.equal(utils.isYouTubeHost("www.youtube.com"), true);
  assert.equal(utils.isYouTubeHost("m.youtube.com"), true);
  assert.equal(utils.isYouTubeHost("youtube.com"), true);
  assert.equal(utils.isYouTubeHost("youtu.be"), true);
  assert.equal(utils.isYouTubeHost("notyoutube.com"), false);
  assert.equal(utils.isYouTubeHost("youtube.com.evil.example"), false);
});

test("extractVideoIdFromUrl extracts IDs from watch, shorts, embed, live, and youtu.be", () => {
  assert.equal(utils.extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(utils.extractVideoIdFromUrl("https://m.youtube.com/watch?list=WL&v=abcDEF_1234"), "abcDEF_1234");
  assert.equal(utils.extractVideoIdFromUrl("https://www.youtube.com/shorts/xyz_9876543"), "xyz_9876543");
  assert.equal(utils.extractVideoIdFromUrl("https://www.youtube.com/embed/12345678901"), "12345678901");
  assert.equal(utils.extractVideoIdFromUrl("https://www.youtube.com/live/LiveId_1234"), "LiveId_1234");
  assert.equal(utils.extractVideoIdFromUrl("https://youtu.be/ShortLink12?t=42"), "ShortLink12");
  assert.equal(utils.extractVideoIdFromUrl("https://www.youtube.com/playlist?list=PL12345"), null);
  assert.equal(utils.extractVideoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("buildWorkerUrl and playlist helpers build canonical YouTube URLs", () => {
  assert.equal(
    utils.buildWorkerUrl("https://youtu.be/dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&ytwm_worker=1&mute=1&autoplay=1"
  );
  assert.equal(utils.buildWorkerUrl("https://www.youtube.com/channel/@test"), null);
  assert.equal(utils.extractPlaylistIdFromUrl("https://www.youtube.com/playlist?list=WL"), "WL");
  assert.equal(utils.buildPlaylistUrl("PLabc-123_X"), "https://www.youtube.com/playlist?list=PLabc-123_X");
});
