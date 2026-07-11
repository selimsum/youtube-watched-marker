"use strict";

(function injectPageScript() {
  var script = document.createElement("script");
  script.id = "ytwm-data-hook";

  function hookBody() {
    console.log("ytwm: hookBody running");
    var WATCHED_TEXT = "Mark as watched";
    var VIDEO_TYPES = ["videoRenderer","compactVideoRenderer","gridVideoRenderer","movieRenderer","compactMovieRenderer","reelItemRenderer","playlistVideoRenderer","compactPlaylistVideoRenderer","channelVideoPlayerRenderer","radioRenderer"];

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
        console.log("ytwm: injecting listItemViewModel into sheet menu");
        var baseCtx = items[0].listItemViewModel.rendererContext;
        var newItem = {listItemViewModel:{title:{content:WATCHED_TEXT},leadingImage:{sources:[{clientResource:{imageName:"CHECK"}}]}}};
        if (baseCtx) newItem.listItemViewModel.rendererContext = JSON.parse(JSON.stringify(baseCtx));
        items.push(newItem);
      }
    }

    function injectInto(val, visited) {
      if (!val || typeof val !== "object" || visited.has(val)) return;
      visited.add(val);

      // Direct checks for known menu locations
      if (val.commentRenderer && val.commentRenderer.actionMenu && val.commentRenderer.actionMenu.menuRenderer && Array.isArray(val.commentRenderer.actionMenu.menuRenderer.items)) {
        injectItem(val.commentRenderer.actionMenu.menuRenderer.items);
      }
      if (val.videoActions && val.videoActions.menuRenderer && Array.isArray(val.videoActions.menuRenderer.items)) {
        injectItem(val.videoActions.menuRenderer.items);
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
          console.log("ytwm: lockupViewModel direct handler hit, listItems length:", cur.listItems.length);
          injectItem(cur.listItems);
        }
      }

      // Generic: find ANY items array with menuServiceItemRenderer that we can inject into
      var children = Array.isArray(val) ? val : Object.values(val);
      for (var k = 0, len = children.length; k < len; k++) {
        var child = children[k];
        if (child && typeof child === "object") {
          if (Array.isArray(child) && child.length > 0) {
            var isMenu = false;
            for (var ci = 0, clen = child.length; ci < clen && ci < 3; ci++) {
              var cci = child[ci];
              if (cci && (cci.menuServiceItemRenderer || cci.listItemViewModel)) { isMenu = true; break; }
            }
            if (isMenu) injectItem(child);
          }
          injectInto(child, visited);
        }
      }
    }

    function modify(js) {
      console.log("ytwm: modify called", js && typeof js, Array.isArray(js));
      injectInto(js, new WeakSet());
    }
    // Inject into ytInitialData right now if it already exists
    if (window.ytInitialData) {
      console.log("ytwm: ytInitialData already set, injecting now");
      try { modify(window.ytInitialData); } catch(e) { console.error("ytwm: error", e); }
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
    console.log("ytwm: hookBody done");
  }

  script.textContent = "(" + hookBody.toString() + ")()";
  document.documentElement.appendChild(script);
  script.remove();
})();
