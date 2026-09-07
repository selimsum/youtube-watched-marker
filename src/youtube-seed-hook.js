"use strict";

(function hookBody() {
    var DEBUG = false;

    function debugLog() {
      if (DEBUG) {
        console.log.apply(console, arguments);
      }
    }

    function debugError() {
      if (DEBUG) {
        console.error.apply(console, arguments);
      }
    }

    if (location.search.indexOf("ytwm_worker=1") !== -1) {
      function forceMutedAutoplay(video) {
        if (!video || video._ytwmMuted) return;
        video._ytwmMuted = true;
        video.muted = true;
        video.setAttribute("muted", "");
        video.volume = 0;
      }
      (new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeName === "VIDEO") forceMutedAutoplay(n);
            if (n.querySelectorAll) {
              var vids = n.querySelectorAll("video");
              for (var k = 0; k < vids.length; k++) forceMutedAutoplay(vids[k]);
            }
          }
        }
      })).observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener("play", function(e) {
        if (e.target && e.target.nodeName === "VIDEO") forceMutedAutoplay(e.target);
      }, true);
      var _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        forceMutedAutoplay(this);
        return _origPlay.apply(this, arguments);
      };
    }

    var WATCHED_TEXT = "Mark as watched";
    var VIDEO_TYPES = ["videoRenderer","compactVideoRenderer","gridVideoRenderer","movieRenderer","compactMovieRenderer","reelItemRenderer","playlistVideoRenderer","compactPlaylistVideoRenderer","channelVideoPlayerRenderer","radioRenderer"];

    function isSelectionMenu(items) {
      if (!Array.isArray(items)) return false;
      for (var si = 0; si < items.length; si++) {
        var entry = items[si];
        if (!entry || typeof entry !== "object") continue;
        var vm = entry.menuServiceItemRenderer || entry.listItemViewModel || entry;
        if (entry.selected === true || entry.isSelected === true) return true;
        if (vm.selected === true || vm.isSelected === true) return true;
        if (vm.selectionState || vm.selectionIndicator || vm.trailingSelectedImage) return true;
        // New UI sort/selection sheets mark the active option via trailing check
        // image or selection state; video action sheets never carry those.
        if (vm.trailingImage && vm.title && vm.leadingImage) {
          try {
            var trailing = JSON.stringify(vm.trailingImage).toLowerCase();
            if (trailing.indexOf("check") !== -1 || trailing.indexOf("select") !== -1) return true;
          } catch (e) {}
        }
        try {
          var cmdText = JSON.stringify(
            (vm.rendererContext && vm.rendererContext.commandContext) || vm.onTap || entry.onTap || ""
          ).toLowerCase();
          if (cmdText.indexOf("sort") !== -1 || cmdText.indexOf("filter") !== -1) return true;
        } catch (e2) {}
      }
      return false;
    }

    function parentHasVideoSignal(obj) {
      if (!obj || typeof obj !== "object") return false;
      if (typeof obj.videoId === "string" && obj.videoId.length >= 6) return true;
      if (typeof obj.contentId === "string" && obj.contentId.length >= 6) return true;
      if (obj.watchEndpoint) return true;
      return false;
    }

    function lockupHasVideoSignal(lockup) {
      if (!lockup || typeof lockup !== "object") return false;
      if (parentHasVideoSignal(lockup)) return true;
      try {
        var stack = [lockup];
        var seen = new WeakSet();
        var depth = [0];
        while (stack.length > 0) {
          var cur = stack.pop();
          var d = depth.pop();
          if (!cur || typeof cur !== "object" || seen.has(cur) || d > 4) continue;
          seen.add(cur);
          if (cur.videoId || cur.watchEndpoint) return true;
          if (typeof cur.contentId === "string" && cur.contentId.length >= 6) return true;
          var ks = Object.keys(cur);
          for (var ki = 0; ki < ks.length; ki++) {
            var cv = cur[ks[ki]];
            if (cv && typeof cv === "object") {
              stack.push(cv);
              depth.push(d + 1);
            }
          }
        }
      } catch (e) {}
      return false;
    }

    function injectItem(items) {
      if (!Array.isArray(items)) return;
      var found = false;
      for (var x = 0; x < items.length; x++) {
        var sv = items[x] && (items[x].menuServiceItemRenderer || items[x].listItemViewModel);
        if (!sv) continue;
        var txt = sv.text || (sv.title && sv.title.content);
        var runs = txt && txt.runs;
        var match = runs ? runs[0] && runs[0].text === WATCHED_TEXT : txt === WATCHED_TEXT;
        if (match) { found = true; break; }
      }
      if (found) return;
      if (items[0] && items[0].menuServiceItemRenderer) {
        items.push({menuServiceItemRenderer:{text:{runs:[{text:WATCHED_TEXT}]},icon:{iconType:"CHECK"},trackingParams:"Cg==",serviceEndpoint:{commandMetadata:{webCommandMetadata:{sendPost:false,apiUrl:""}}}}});
      } else if (items[0] && items[0].listItemViewModel) {
        debugLog("ytwm: injecting listItemViewModel into sheet menu");
        var baseCtx = items[0].listItemViewModel.rendererContext;
        var newItem = {listItemViewModel:{title:{content:WATCHED_TEXT},leadingImage:{sources:[{clientResource:{imageName:"CHECK"}}]}}};
        if (baseCtx) newItem.listItemViewModel.rendererContext = JSON.parse(JSON.stringify(baseCtx));
        items.push(newItem);
      }
    }

    function injectInto(val, visited, inVideoContext) {
      if (!val || typeof val !== "object" || visited.has(val)) return;
      visited.add(val);

      // Direct checks for known video menu locations only.
      // NOTE: comment menus and playlist "Sort by" sheets are intentionally
      // excluded — they are not tied to a single video.
      if (val.videoActions && val.videoActions.menuRenderer && Array.isArray(val.videoActions.menuRenderer.items)) {
        if (!isSelectionMenu(val.videoActions.menuRenderer.items)) {
          injectItem(val.videoActions.menuRenderer.items);
        }
      }
      if (val.lockupViewModel) {
        var cur = val.lockupViewModel;
        cur = cur.metadata && cur.metadata.lockupMetadataViewModel;
        cur = cur && cur.menuButton && cur.menuButton.buttonViewModel;
        cur = cur && cur.onTap && cur.onTap.innertubeCommand;
        cur = cur && cur.showSheetCommand && cur.showSheetCommand.panelLoadingStrategy;
        cur = cur && cur.inlineContent && cur.inlineContent.sheetViewModel;
        cur = cur && cur.content && cur.content.listViewModel;
        if (cur && Array.isArray(cur.listItems)) {
          debugLog("ytwm: lockupViewModel direct handler hit, listItems length:", cur.listItems.length);
          if (!isSelectionMenu(cur.listItems) && lockupHasVideoSignal(val.lockupViewModel)) {
            injectItem(cur.listItems);
          }
        }
      }

      // Generic fallback: only inject inside video renderer subtrees.
      // The playlist "Sort by" sheet lives outside any video renderer, so it
      // is skipped here even though it uses the same item renderer types.
      var childVideoContext = Boolean(inVideoContext) || parentHasVideoSignal(val);
      var keys = Object.keys(val);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var child = val[key];
        var keyVideoContext = childVideoContext ||
          VIDEO_TYPES.indexOf(key) !== -1 ||
          (key === "lockupViewModel" && lockupHasVideoSignal(child));
        if (Array.isArray(child) && child.length > 0) {
          var isMenu = false;
          for (var ci = 0; ci < child.length && ci < 3; ci++) {
            if (child[ci] && (child[ci].menuServiceItemRenderer || child[ci].listItemViewModel)) { isMenu = true; break; }
          }
          if (isMenu && keyVideoContext && !isSelectionMenu(child)) injectItem(child);
        }
        if (child && typeof child === "object") injectInto(child, visited, keyVideoContext);
      }
    }

    function modify(js) {
      debugLog("ytwm: modify called", js && typeof js, Array.isArray(js));
      injectInto(js, new WeakSet());
    }
    // Inject into ytInitialData right now if it already exists
    if (window.ytInitialData) {
      debugLog("ytwm: ytInitialData already set, injecting now");
      try { modify(window.ytInitialData); } catch(e) { debugError("ytwm: error", e); }
    }

    // Intercept ytInitialData being set on window
    var _origData = void 0;
    Object.defineProperty(window, "ytInitialData", {
      configurable: true,
      enumerable: true,
      get: function() { return _origData; },
      set: function(v) {
        if (v && typeof v === "object") { try { modify(v); } catch(e) {} }
        _origData = v;
      }
    });

    // Hook fetch
    var _fetch = window.fetch.bind(window);
    window.fetch = function(u, i) {
      var url = (typeof u === "string" ? u : (u && u.url)) || "";
      if (url.indexOf("/youtubei/v1/") === -1) return _fetch(u, i);
      return _fetch(u, i).then(function(r) {
        if (!r.ok) return r;
        var cl = r.clone();
        return cl.json().then(function(j) {
          try { modify(j); } catch(e) {}
          return new Response(JSON.stringify(j), { status: r.status, statusText: r.statusText, headers: r.headers });
        }).catch(function() { return r; });
      });
    };

    // Hook XMLHttpRequest
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) {
      this._ytwmUrl = url;
      return _open.apply(this, arguments);
    };
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(b) {
      if (this._ytwmUrl && this._ytwmUrl.indexOf("/youtubei/v1/") !== -1) {
        var self = this;
        self.addEventListener("readystatechange", function() {
          if (self.readyState === 4) {
            try {
              var j = JSON.parse(self.responseText);
              modify(j);
              var modified = JSON.stringify(j);
              Object.defineProperty(self, "responseText", {
                configurable: true,
                get: function() { return modified; }
              });
            } catch(e) {}
          }
        });
      }
      return _send.apply(this, arguments);
    };
    debugLog("ytwm: hookBody done");
})();
