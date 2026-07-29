"use strict";

(function injectPageScript() {
  var isPlaylistPage = /[?&]list=|\/playlist\//.test(window.location.href);

  if (isPlaylistPage) {
    var extApi = typeof browser !== "undefined" ? browser : chrome;
    extApi.storage.local.get("enableOnWatchlistPlaylists").then(function(result) {
      if (result.enableOnWatchlistPlaylists === false) {
        var flag = document.createElement("script");
        flag.id = "ytwm-skip-injection";
        flag.textContent = "window.__ytwmDisableOnPlaylist=true;";
        document.documentElement.appendChild(flag);
        flag.remove();
      }
    }).catch(function() {});
  }

  var script = document.createElement("script");
  script.id = "ytwm-data-hook";
  script.src = chrome.runtime.getURL("src/youtube-seed-hook.js");
  script.onload = function() {
    this.remove();
  };
  document.documentElement.appendChild(script);
})();
