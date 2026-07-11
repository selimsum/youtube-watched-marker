const assert = require("assert");
const { getExtensionApi } = require("../src/utils/extension.js");

describe("getExtensionApi", function() {
  let originalBrowser;
  let originalChrome;

  beforeEach(function() {
    originalBrowser = global.browser;
    originalChrome = global.chrome;
    delete global.browser;
    delete global.chrome;
  });

  afterEach(function() {
    if (originalBrowser !== undefined) {
      global.browser = originalBrowser;
    } else {
      delete global.browser;
    }

    if (originalChrome !== undefined) {
      global.chrome = originalChrome;
    } else {
      delete global.chrome;
    }
  });

  it("should return browser if browser is defined", function() {
    global.browser = { name: "mockBrowser" };
    global.chrome = { name: "mockChrome" };

    const api = getExtensionApi();
    assert.strictEqual(api.name, "mockBrowser");
  });

  it("should return chrome if browser is not defined", function() {
    global.chrome = { name: "mockChrome" };

    const api = getExtensionApi();
    assert.strictEqual(api.name, "mockChrome");
  });
});
