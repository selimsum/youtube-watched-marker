"use strict";

(function injectPageScript() {
  var script = document.createElement("script");
  script.id = "ytwm-data-hook";

  function hookBody() {
    var WATCHED_TEXT = "Mark as watched";
    var VIDEO_TYPES = ["videoRenderer","compactVideoRenderer","gridVideoRenderer","movieRenderer","compactMovieRenderer","reelItemRenderer","playlistVideoRenderer","compactPlaylistVideoRenderer","channelVideoPlayerRenderer","radioRenderer"];

    function injectInto(val, visited) {
      if (!val || typeof val !== "object" || visited.has(val)) return;
      visited.add(val);

      for (var t = 0; t < VIDEO_TYPES.length; t++) {
        var r = val[VIDEO_TYPES[t]];
        if (r && r.menu && r.menu.menuRenderer && Array.isArray(r.menu.menuRenderer.items) && r.menu.menuRenderer.items.length > 0) {
          var items = r.menu.menuRenderer.items;
          var found = false;
          for (var i = 0; i < items.length; i++) {
            if (items[i] && items[i].menuServiceItemRenderer && items[i].menuServiceItemRenderer.text && items[i].menuServiceItemRenderer.text.runs && items[i].menuServiceItemRenderer.text.runs[0] && items[i].menuServiceItemRenderer.text.runs[0].text === WATCHED_TEXT) {
              found = true;
              break;
            }
          }
          if (!found) {
            items.push({menuServiceItemRenderer:{text:{runs:[{text:WATCHED_TEXT}]},icon:{iconType:"ADD_TO_QUEUE_TAIL"},trackingParams:"Cg==",serviceEndpoint:{commandMetadata:{webCommandMetadata:{sendPost:false,apiUrl:""}}}}});
          }
        }
      }

      if (val.commentRenderer && val.commentRenderer.actionMenu && val.commentRenderer.actionMenu.menuRenderer && Array.isArray(val.commentRenderer.actionMenu.menuRenderer.items)) {
        var citems = val.commentRenderer.actionMenu.menuRenderer.items;
        var cfound = false;
        for (var ci = 0; ci < citems.length; ci++) {
          if (citems[ci] && citems[ci].menuServiceItemRenderer && citems[ci].menuServiceItemRenderer.text && citems[ci].menuServiceItemRenderer.text.runs && citems[ci].menuServiceItemRenderer.text.runs[0] && citems[ci].menuServiceItemRenderer.text.runs[0].text === WATCHED_TEXT) { cfound = true; break; }
        }
        if (!cfound) {
          citems.push({menuServiceItemRenderer:{text:{runs:[{text:WATCHED_TEXT}]},icon:{iconType:"ADD_TO_QUEUE_TAIL"},trackingParams:"Cg==",serviceEndpoint:{commandMetadata:{webCommandMetadata:{sendPost:false,apiUrl:""}}}}});
        }
      }

      if (val.videoActions && val.videoActions.menuRenderer && Array.isArray(val.videoActions.menuRenderer.items)) {
        var vitems = val.videoActions.menuRenderer.items;
        var vfound = false;
        for (var vi = 0; vi < vitems.length; vi++) {
          if (vitems[vi] && vitems[vi].menuServiceItemRenderer && vitems[vi].menuServiceItemRenderer.text && vitems[vi].menuServiceItemRenderer.text.runs && vitems[vi].menuServiceItemRenderer.text.runs[0] && vitems[vi].menuServiceItemRenderer.text.runs[0].text === WATCHED_TEXT) { vfound = true; break; }
        }
        if (!vfound) {
          vitems.push({menuServiceItemRenderer:{text:{runs:[{text:WATCHED_TEXT}]},icon:{iconType:"ADD_TO_QUEUE_TAIL"},trackingParams:"Cg==",serviceEndpoint:{commandMetadata:{webCommandMetadata:{sendPost:false,apiUrl:""}}}}});
        }
      }

      // Lockup view model sheet menus
      if (val.lockupViewModel) {
        var cur = val.lockupViewModel;
        cur = cur.metadata && cur.metadata.lockupMetadataViewModel;
        cur = cur && cur.menuButton && cur.menuButton.buttonViewModel;
        cur = cur && cur.onTap && cur.onTap.innertubeCommand;
        cur = cur && cur.showSheetCommand && cur.showSheetCommand.panelLoadingStrategy;
        cur = cur && cur.inlineContent && cur.inlineContent.sheetViewModel;
        cur = cur && cur.content && cur.content.listViewModel;
        if (cur && Array.isArray(cur.listItems) && cur.listItems.length > 0) {
          var litems = cur.listItems;
          var lfound = false;
          for (var li = 0; li < litems.length; li++) {
            if (litems[li] && litems[li].listItemViewModel && litems[li].listItemViewModel.title && litems[li].listItemViewModel.title.content === WATCHED_TEXT) { lfound = true; break; }
          }
          if (!lfound) {
            var baseCtx = litems[0] && litems[0].listItemViewModel && litems[0].listItemViewModel.rendererContext;
            var newItem = {listItemViewModel:{title:{content:WATCHED_TEXT},leadingImage:{sources:[{clientResource:{imageName:'QUEUE_ADD_TO'}}]}}};
            if (baseCtx) { newItem.listItemViewModel.rendererContext = JSON.parse(JSON.stringify(baseCtx)); }
            litems.push(newItem);
          }
        }
      }

      if (Array.isArray(val)) {
        for (var a = 0; a < val.length; a++) {
          if (val[a] && typeof val[a] === "object") injectInto(val[a], visited);
        }
      } else {
        var keys = Object.keys(val);
        for (var k = 0; k < keys.length; k++) {
          if (val[keys[k]] && typeof val[keys[k]] === "object") injectInto(val[keys[k]], visited);
        }
      }
    }

    function modify(js) {
      injectInto(js, new WeakSet());
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
  }

  script.textContent = "(" + hookBody.toString() + ")()";
  document.documentElement.appendChild(script);
  script.remove();
})();
