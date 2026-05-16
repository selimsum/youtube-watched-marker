const { describe, it, before, after } = require("mocha");
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../src/youtube-content.js'), 'utf8');

function createEnvironment() {
  const documentElement = { nodeType: 1, matches: () => false, querySelectorAll: () => [] };
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }), location: { pathname: '' } },
    document: {
      addEventListener: () => {},
      documentElement,
      querySelector: () => null,
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} })
    },
    console,
    Node: { ELEMENT_NODE: 1 },
    chrome: { runtime: { sendMessage: () => Promise.resolve({}), onMessage: { addListener: () => {} } } },
    browser: { runtime: { sendMessage: () => Promise.resolve({}), onMessage: { addListener: () => {} } } },
    MutationObserver: class { observe() {} disconnect() {} },
    Date // Inject the host Date so it uses our mocked Date.now
  });

  vm.runInContext(code, context);
  return context;
}

describe('parsePublishDateText', () => {
  let parsePublishDateText;
  const originalDateNow = Date.now;
  const FIXED_NOW = 1715860800000; // 2024-05-16T12:00:00.000Z
  const DAY_MS = 24 * 60 * 60 * 1000;

  before(() => {
    global.Date.now = () => FIXED_NOW;
    const env = createEnvironment();
    parsePublishDateText = env.parsePublishDateText;
  });

  after(() => {
    global.Date.now = originalDateNow;
  });

  it('should parse "1 year ago"', () => {
    const result = parsePublishDateText('1 year ago');
    assert.ok(result);
    assert.strictEqual(result.precision, 'approximate');
    assert.strictEqual(result.publishedMs, FIXED_NOW - (365 * DAY_MS));
  });

  it('should parse "Streamed 2 days ago"', () => {
    const result = parsePublishDateText('Streamed 2 days ago');
    assert.ok(result);
    assert.strictEqual(result.precision, 'approximate');
    assert.strictEqual(result.publishedMs, FIXED_NOW - (2 * DAY_MS));
  });

  it('should parse exact dates like "15.11.2023"', () => {
    const result = parsePublishDateText('15.11.2023');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2023, 10, 15).getTime());
  });

  it('should handle exact dates with formatting', () => {
    const result = parsePublishDateText('Nov 15, 2023');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2023, 10, 15).getTime());
  });

  it('should parse YYYY-MM-DD', () => {
    const result = parsePublishDateText('2023-11-15');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2023, 10, 15).getTime());
  });

  it('should parse MM/DD/YYYY handled as DD.MM.YYYY due to logic', () => {
    const result = parsePublishDateText('15/11/2023');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2023, 10, 15).getTime());
  });

  it('should parse Month DD YYYY', () => {
    const result = parsePublishDateText('Jan 1 2024');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2024, 0, 1).getTime());
  });

  it('should parse DD Month YYYY', () => {
    const result = parsePublishDateText('1 Jan 2024');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2024, 0, 1).getTime());
  });

  it('should parse Turkish month names', () => {
    const result = parsePublishDateText('15 ocak 2024');
    assert.ok(result);
    assert.strictEqual(result.precision, 'exact');
    assert.strictEqual(result.publishedMs, new Date(2024, 0, 15).getTime());
  });

  it('should parse Turkish relative dates', () => {
    const result = parsePublishDateText('2 hafta once'); // "2 weeks ago"
    assert.ok(result);
    assert.strictEqual(result.precision, 'approximate');
    assert.strictEqual(result.publishedMs, FIXED_NOW - (2 * 7 * DAY_MS));
  });

  it('should return null for invalid text', () => {
    assert.strictEqual(parsePublishDateText('invalid date'), null);
    assert.strictEqual(parsePublishDateText(null), null);
    assert.strictEqual(parsePublishDateText(''), null);
  });
});
