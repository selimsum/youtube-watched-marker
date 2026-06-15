"use strict";

function getExtensionApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }

  return chrome;
}

if (typeof module !== "undefined") {
  module.exports = {
    getExtensionApi
  };
}
