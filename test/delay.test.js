const assert = require("assert");
const { delay } = require("../src/delay.js");

describe("delay", () => {
  let originalSetTimeout;

  beforeEach(() => {
    // Save the original setTimeout to restore later
    originalSetTimeout = global.setTimeout;
  });

  afterEach(() => {
    // Restore the original setTimeout
    global.setTimeout = originalSetTimeout;
  });

  it("should return a Promise", () => {
    const result = delay(100);
    assert.strictEqual(result instanceof Promise, true);
  });

  it("should call setTimeout with the correct delay", () => {
    let timeoutMs;
    let timeoutCb;

    // Mock setTimeout
    global.setTimeout = (cb, ms) => {
      timeoutCb = cb;
      timeoutMs = ms;
    };

    const ms = 250;
    const promise = delay(ms);

    // Verify setTimeout was called correctly
    assert.strictEqual(timeoutMs, ms);
    assert.strictEqual(typeof timeoutCb, "function");

    // Resolve the timeout
    timeoutCb();

    // The promise should resolve
    return promise.then(() => {
      assert.ok(true, "Promise resolved");
    });
  });
});
