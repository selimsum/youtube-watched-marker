const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fileContent = fs.readFileSync(path.join(__dirname, '../../src/youtube-content.js'), 'utf-8');

const context = {
  chrome: {
    runtime: {
      onMessage: {
        addListener: () => {}
      },
      sendMessage: () => Promise.resolve({ isQueueEnabled: true })
    }
  },
  browser: undefined,
  document: {
    documentElement: {
      hasAttribute: () => false,
      append: () => {}
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {} }),
    addEventListener: () => {}
  },
  window: {
    getComputedStyle: () => ({})
  },
  MutationObserver: class { observe() {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  requestAnimationFrame: () => {},
  Node: {
    ELEMENT_NODE: 1,
    DOCUMENT_FRAGMENT_NODE: 11
  }
};

vm.createContext(context);
vm.runInContext(fileContent, context);

const { hasReadableContrast } = context;

describe('hasReadableContrast', () => {
  it('should return true when contrast ratio is >= 4.5', () => {
    // black on white
    expect(hasReadableContrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(true);
    // white on black
    expect(hasReadableContrast('rgb(255, 255, 255)', 'rgb(0, 0, 0)')).toBe(true);
  });

  it('should return false when contrast ratio is < 4.5', () => {
    // dark gray on black
    expect(hasReadableContrast('rgb(50, 50, 50)', 'rgb(0, 0, 0)')).toBe(false);
    // light gray on white
    expect(hasReadableContrast('rgb(200, 200, 200)', 'rgb(255, 255, 255)')).toBe(false);
  });

  it('should return true when color format is invalid (null luminance)', () => {
    expect(hasReadableContrast('invalid', 'rgb(255, 255, 255)')).toBe(true);
    expect(hasReadableContrast('rgb(255, 255, 255)', 'invalid')).toBe(true);
    expect(hasReadableContrast('invalid', 'invalid')).toBe(true);
  });

  it('should calculate contrast correctly for specific color pairs', () => {
    // Example from WCAG: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
    // Ratio 4.5:1 minimum for normal text

    // Very slightly above 4.5 (passes)
    expect(hasReadableContrast('rgb(118, 118, 118)', 'rgb(255, 255, 255)')).toBe(true);

    // Very slightly below 4.5 (fails)
    expect(hasReadableContrast('rgb(119, 119, 119)', 'rgb(255, 255, 255)')).toBe(false);

    // Exact same colors (fails, ratio is 1:1)
    expect(hasReadableContrast('rgb(100, 100, 100)', 'rgb(100, 100, 100)')).toBe(false);

    // Some custom cases with RGBA, checking alpha is ignored as per regex
    expect(hasReadableContrast('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBe(true);
    expect(hasReadableContrast('rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.5)')).toBe(true);
  });
});
