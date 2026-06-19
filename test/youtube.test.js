"use strict";

const assert = require("assert");
const { isYouTubeHost } = require("../src/utils/youtube");

describe("YouTube Utility Functions", () => {
  describe("isYouTubeHost()", () => {
    it("should return true for youtube.com", () => {
      assert.strictEqual(isYouTubeHost("youtube.com"), true);
    });

    it("should return true for youtu.be", () => {
      assert.strictEqual(isYouTubeHost("youtu.be"), true);
    });

    it("should return true for subdomains of youtube.com", () => {
      assert.strictEqual(isYouTubeHost("www.youtube.com"), true);
      assert.strictEqual(isYouTubeHost("m.youtube.com"), true);
      assert.strictEqual(isYouTubeHost("music.youtube.com"), true);
    });

    it("should return true regardless of case", () => {
      assert.strictEqual(isYouTubeHost("YOUTUBE.COM"), true);
      assert.strictEqual(isYouTubeHost("Youtu.Be"), true);
      assert.strictEqual(isYouTubeHost("WWW.YOUTUBE.COM"), true);
    });

    it("should return false for unrelated domains", () => {
      assert.strictEqual(isYouTubeHost("google.com"), false);
      assert.strictEqual(isYouTubeHost("example.com"), false);
      assert.strictEqual(isYouTubeHost("youtube.com.org"), false);
      assert.strictEqual(isYouTubeHost("fakeyoutube.com"), false);
    });

    it("should return false for null, undefined, or empty inputs", () => {
      assert.strictEqual(isYouTubeHost(null), false);
      assert.strictEqual(isYouTubeHost(undefined), false);
      assert.strictEqual(isYouTubeHost(""), false);
    });

    it("should handle non-string inputs gracefully", () => {
        assert.strictEqual(isYouTubeHost({}), false);
        assert.strictEqual(isYouTubeHost(123), false);
        assert.strictEqual(isYouTubeHost(true), false);
    })
  });
});
