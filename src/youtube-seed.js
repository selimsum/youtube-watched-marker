"use strict";

(function injectPageScript() {
  var script = document.createElement("script");
  script.id = "ytwm-data-hook";
  script.src = chrome.runtime.getURL("src/youtube-seed-hook.js");
  script.onload = function() {
    this.remove();
  };
  document.documentElement.appendChild(script);
})();
