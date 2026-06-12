"use strict";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { delay };
}
