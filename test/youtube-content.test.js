const { expect } = require("chai");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const sourceCode = fs.readFileSync(path.resolve(__dirname, "../src/youtube-content.js"), "utf-8");

describe("youtube-content.js", () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
      runScripts: "dangerously"
    });
    window = dom.window;
    document = window.document;

    // Mock extension API
    window.chrome = {
      runtime: {
        sendMessage: () => Promise.resolve({}),
        onMessage: {
          addListener: () => {}
        }
      }
    };
    window.browser = window.chrome;

    const scriptEl = document.createElement("script");
    scriptEl.textContent = sourceCode;
    document.body.appendChild(scriptEl);
  });

  describe("color manipulation", () => {
    it("should parse valid RGB colors", () => {
      const parsed = window.parseRgbColor("rgb(255, 128, 0)");
      expect(parsed).to.deep.equal({ r: 255, g: 128, b: 0 });
    });

    it("should return null for invalid RGB colors", () => {
      expect(window.parseRgbColor("invalid")).to.be.null;
    });

    it("should detect dark colors correctly", () => {
      expect(window.isDarkColor("rgb(0, 0, 0)")).to.be.true;
      expect(window.isDarkColor("rgb(255, 255, 255)")).to.be.false;
      expect(window.isDarkColor("rgb(40, 40, 40)")).to.be.true;
    });

    it("should calculate relative luminance", () => {
      expect(window.getRelativeLuminance("rgb(0, 0, 0)")).to.be.closeTo(0, 0.01);
      expect(window.getRelativeLuminance("rgb(255, 255, 255)")).to.be.closeTo(1, 0.01);
    });

    it("should check contrast correctly", () => {
      expect(window.hasReadableContrast("rgb(255, 255, 255)", "rgb(0, 0, 0)")).to.be.true;
      expect(window.hasReadableContrast("rgb(128, 128, 128)", "rgb(128, 128, 128)")).to.be.false;
    });

    it("should mix RGB colors correctly based on amount", () => {
      expect(window.mixRgbColors("rgb(0, 0, 0)", "rgb(255, 255, 255)", 0.5)).to.equal("rgb(128, 128, 128)");
      expect(window.mixRgbColors("rgb(0, 0, 0)", "rgb(255, 255, 255)", 0)).to.equal("rgb(0, 0, 0)");
      expect(window.mixRgbColors("rgb(0, 0, 0)", "rgb(255, 255, 255)", 1)).to.equal("rgb(255, 255, 255)");
      expect(window.mixRgbColors("rgb(200, 100, 50)", "rgb(100, 50, 25)", 0.2)).to.equal("rgb(180, 90, 45)");
    });

    it("should return baseValue if either color is invalid", () => {
      expect(window.mixRgbColors("invalid", "rgb(255, 255, 255)", 0.5)).to.equal("invalid");
      expect(window.mixRgbColors("rgb(0, 0, 0)", "invalid", 0.5)).to.equal("rgb(0, 0, 0)");
      expect(window.mixRgbColors("invalid_base", "invalid_overlay", 0.5)).to.equal("invalid_base");
    });
  });

  describe("video URL parsing", () => {
    it("should extract video ID from standard watch URLs", () => {
      expect(window.getVideoIdFromUrl("https://www.youtube.com/watch?v=12345678901")).to.equal("12345678901");
      expect(window.getVideoIdFromUrl("https://youtube.com/watch?v=12345678901&t=5s")).to.equal("12345678901");
    });

    it("should extract video ID from shorts URLs", () => {
      expect(window.getVideoIdFromUrl("https://www.youtube.com/shorts/12345678901")).to.equal("12345678901");
    });

    it("should extract video ID from embed URLs", () => {
      expect(window.getVideoIdFromUrl("https://www.youtube.com/embed/12345678901")).to.equal("12345678901");
    });

    it("should extract video ID from live URLs", () => {
      expect(window.getVideoIdFromUrl("https://www.youtube.com/live/12345678901")).to.equal("12345678901");
    });

    it("should return null for invalid URLs", () => {
      expect(window.getVideoIdFromUrl("https://www.google.com")).to.be.null;
      expect(window.getVideoIdFromUrl("invalid")).to.be.null;
    });
  });

  describe("isVideoUrl", () => {
    it("should return true for standard watch URLs", () => {
      expect(window.isVideoUrl("https://www.youtube.com/watch?v=12345678901")).to.be.true;
      expect(window.isVideoUrl("/watch?v=12345678901")).to.be.true;
    });

    it("should return true for shorts URLs", () => {
      expect(window.isVideoUrl("https://www.youtube.com/shorts/12345678901")).to.be.true;
      expect(window.isVideoUrl("/shorts/12345678901")).to.be.true;
    });

    it("should return true for live URLs", () => {
      expect(window.isVideoUrl("https://www.youtube.com/live/12345678901")).to.be.true;
      expect(window.isVideoUrl("/live/12345678901")).to.be.true;
    });

    it("should return false for other YouTube URLs", () => {
      expect(window.isVideoUrl("https://www.youtube.com/@channel")).to.be.false;
      expect(window.isVideoUrl("https://www.youtube.com/feed/subscriptions")).to.be.false;
      expect(window.isVideoUrl("https://www.youtube.com/")).to.be.false;
    });

    it("should return false for empty or falsy values", () => {
      expect(window.isVideoUrl(null)).to.be.false;
      expect(window.isVideoUrl(undefined)).to.be.false;
      expect(window.isVideoUrl("")).to.be.false;
    });
  });

  describe("date parsing", () => {
    it("should parse relative unit days correctly", () => {
      expect(window.getRelativeUnitDays("day")).to.equal(1);
      expect(window.getRelativeUnitDays("days")).to.equal(1);
      expect(window.getRelativeUnitDays("week")).to.equal(7);
      expect(window.getRelativeUnitDays("weeks")).to.equal(7);
      expect(window.getRelativeUnitDays("month")).to.equal(30);
      expect(window.getRelativeUnitDays("months")).to.equal(30);
      expect(window.getRelativeUnitDays("year")).to.equal(365);
      expect(window.getRelativeUnitDays("years")).to.equal(365);
      expect(window.getRelativeUnitDays("unknown")).to.be.null;
    });
  });

  describe("DOM interactions", () => {
    it("should get element title from title attribute", () => {
      const titleEl = document.createElement("a");
      titleEl.setAttribute("title", "A video title");

      expect(window.getElementTitle(titleEl)).to.equal("A video title");
    });

    it("should fallback to text content for titles", () => {
      const titleEl = document.createElement("a");
      titleEl.textContent = "A video title by Creator";

      expect(window.getElementTitle(titleEl)).to.equal("A video title by Creator");
    });

    it("should normalize whitespace in titles", () => {
      const titleEl = document.createElement("a");
      titleEl.textContent = "  A   video \n title  ";

      expect(window.getElementTitle(titleEl)).to.equal("A video title");
    });
  });
});
