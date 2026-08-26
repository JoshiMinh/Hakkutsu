/**
 * YouTube Main-World Bridge Code & Injector (asbplayer style).
 *
 * Runs directly in YouTube's MAIN world context:
 * 1. Intercepts window.fetch and XMLHttpRequest for /api/timedtext requests.
 * 2. Controls #movie_player to switch caption tracks using YouTube's internal APIs.
 * 3. Broadcasts caption tracks and captured timedtext to the content script.
 */

const MAIN_BRIDGE_SCRIPT_ID = "hk-youtube-main-bridge";

export const MAIN_BRIDGE_SCRIPT_CONTENT = `
(function() {
  if (window.__HK_YT_BRIDGE_INITIALIZED__) return;
  window.__HK_YT_BRIDGE_INITIALIZED__ = true;

  // ── 1. Network Stream Interceptors (/api/timedtext) ─────────────────────────

  // Intercept window.fetch
  var originalFetch = window.fetch;
  window.fetch = function() {
    var args = Array.prototype.slice.call(arguments);
    var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");

    return originalFetch.apply(this, args).then(function(response) {
      if (url && (url.indexOf("/api/timedtext") !== -1 || url.indexOf("timedtext?") !== -1)) {
        try {
          var clone = response.clone();
          clone.text().then(function(text) {
            if (text && text.trim().length > 0) {
              window.dispatchEvent(
                new CustomEvent("hakkutsu:captured-timedtext", {
                  detail: { url: url, text: text }
                })
              );
            }
          }).catch(function() {});
        } catch (e) {}
      }
      return response;
    });
  };

  // Intercept XMLHttpRequest
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__hk_url = typeof url === "string" ? url : "";
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var self = this;
    if (self.__hk_url && (self.__hk_url.indexOf("/api/timedtext") !== -1 || self.__hk_url.indexOf("timedtext?") !== -1)) {
      self.addEventListener("load", function() {
        try {
          if (self.responseText && self.responseText.trim().length > 0) {
            window.dispatchEvent(
              new CustomEvent("hakkutsu:captured-timedtext", {
                detail: { url: self.__hk_url, text: self.responseText }
              })
            );
          }
        } catch (e) {}
      });
    }
    return originalSend.apply(this, arguments);
  };

  // ── 2. Player Track Controller ──────────────────────────────────────────────

  function setPlayerCaptionTrack(track) {
    if (!track) return;
    var player = document.querySelector("#movie_player");
    if (!player) return;

    var trackObj = {
      languageCode: track.languageCode || "",
      vssId: track.vssId || "",
      name: track.name || "",
      kind: track.kind || ""
    };

    var applyTrack = function() {
      try {
        if (typeof player.setOption === "function") {
          player.setOption("captions", "track", trackObj);
          player.setOption("captions", "reload", true);
        }
      } catch (e) {}

      try {
        if (typeof player.toggleSubtitlesOn === "function") {
          player.toggleSubtitlesOn();
        }
      } catch (e) {}
    };

    try {
      if (typeof player.loadModule === "function") {
        player.loadModule("captions");
      }
    } catch (e) {}

    applyTrack();
    setTimeout(applyTrack, 150);
  }

  window.addEventListener("hakkutsu:set-player-track", function(e) {
    var track = e.detail && e.detail.track;
    if (track) {
      setPlayerCaptionTrack(track);
    }
  });

  // ── 3. Player Caption Track Extractor ───────────────────────────────────────

  function formatTrackDisplayName(t) {
    if (typeof t.name === "string" && t.name) return t.name;
    if (t.name && t.name.simpleText) return t.name.simpleText;
    if (Array.isArray(t.name && t.name.runs)) {
      var text = t.name.runs.map(function(r) { return r.text || ""; }).join("");
      if (text) return text;
    }
    if (typeof t.displayName === "string" && t.displayName) return t.displayName;
    if (typeof t.languageName === "string" && t.languageName) return t.languageName;
    if (typeof t.languageCode === "string" && t.languageCode) return t.languageCode;
    return "Track";
  }

  function formatLanguageCode(t) {
    if (typeof t.languageCode === "string" && t.languageCode) {
      return t.languageCode.toLowerCase().replace(/^\\./, "").replace(/^a\\./, "");
    }
    if (typeof t.vssId === "string" && t.vssId) {
      return t.vssId.toLowerCase().replace(/^\\.?[a-z0-9_-]*\\./i, "").replace(/^\\./, "");
    }
    return "";
  }

  function extractCurrentVideoId() {
    var moviePlayer = document.querySelector("#movie_player");
    if (moviePlayer && typeof moviePlayer.getVideoData === "function") {
      var vid = moviePlayer.getVideoData() && moviePlayer.getVideoData().video_id;
      if (vid) return vid;
    }
    var match = window.location.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
      window.location.href.match(/youtu\\.be\\/([a-zA-Z0-9_-]{11})/) ||
      window.location.href.match(/(?:embed|shorts|live|v)\\/([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : "";
  }

  function getPlayerCaptionTracks() {
    var currentVideoId = extractCurrentVideoId();
    var tracks = [];
    var seenUrls = {};

    var moviePlayer = document.querySelector("#movie_player");
    var candidates = [];

    // 1. moviePlayer.getPlayerResponse()
    if (moviePlayer && typeof moviePlayer.getPlayerResponse === "function") {
      try {
        var pr = moviePlayer.getPlayerResponse();
        if (pr) candidates.push(pr);
      } catch (e) {}
    }

    // 2. window.ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse) {
      candidates.push(window.ytInitialPlayerResponse);
    }

    // 3. raw_player_response from ytplayer config
    if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response) {
      try {
        var raw = window.ytplayer.config.args.raw_player_response;
        candidates.push(typeof raw === "string" ? JSON.parse(raw) : raw);
      } catch (e) {}
    }

    // 4. ytd-watch-flexy element data
    var flexy = document.querySelector("ytd-watch-flexy");
    if (flexy && flexy.data && flexy.data.playerResponse) {
      candidates.push(flexy.data.playerResponse);
    }

    for (var c = 0; c < candidates.length; c++) {
      var pResp = candidates[c];
      if (!pResp) continue;
      var captionTracks =
        (pResp.captions && pResp.captions.playerCaptionsTracklistRenderer && pResp.captions.playerCaptionsTracklistRenderer.captionTracks) ||
        (pResp.captions && pResp.captions.playerCaptionsRenderer && pResp.captions.playerCaptionsRenderer.captionTracks);

      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        for (var i = 0; i < captionTracks.length; i++) {
          var t = captionTracks[i];
          var rawUrl = t.baseUrl || t.url || "";
          var langCode = formatLanguageCode(t);
          var isAuto = t.kind === "asr" || (t.vssId && (t.vssId.indexOf("a.") === 0 || t.vssId.indexOf("a:") === 0));
          var name = formatTrackDisplayName(t);

          if (!rawUrl && currentVideoId && langCode) {
            rawUrl = "https://www.youtube.com/api/timedtext?v=" + currentVideoId + "&lang=" + langCode + "&fmt=json3";
          }
          if (!rawUrl || seenUrls[rawUrl]) continue;
          seenUrls[rawUrl] = true;

          tracks.push({
            id: "yt_main_" + i + "_" + langCode,
            name: name,
            languageCode: langCode,
            baseUrl: rawUrl,
            vssId: t.vssId,
            kind: t.kind,
            isAutoGenerated: !!isAuto
          });
        }
        if (tracks.length > 0) break;
      }
    }

    // 5. moviePlayer.getOption("captions", "tracklist")
    if (moviePlayer && typeof moviePlayer.getOption === "function") {
      try {
        var list = moviePlayer.getOption("captions", "tracklist");
        if (Array.isArray(list) && list.length > 0) {
          for (var j = 0; j < list.length; j++) {
            var item = list[j];
            var itemUrl = item.baseUrl || item.url || "";
            if (!itemUrl || seenUrls[itemUrl]) continue;
            seenUrls[itemUrl] = true;

            var itemLang = formatLanguageCode(item);
            var itemAuto = item.kind === "asr" || (item.vssId && (item.vssId.indexOf("a.") === 0 || item.vssId.indexOf("a:") === 0));
            var itemName = formatTrackDisplayName(item);

            tracks.push({
              id: "yt_option_" + j + "_" + itemLang,
              name: itemName,
              languageCode: itemLang,
              baseUrl: itemUrl,
              vssId: item.vssId,
              kind: item.kind,
              isAutoGenerated: !!itemAuto
            });
          }
        }
      } catch (e) {}
    }

    // 6. moviePlayer.getAudioTrack()?.captionTracks
    if (moviePlayer && typeof moviePlayer.getAudioTrack === "function") {
      try {
        var audioTracks = moviePlayer.getAudioTrack() && moviePlayer.getAudioTrack().captionTracks;
        if (Array.isArray(audioTracks) && audioTracks.length > 0) {
          for (var k = 0; k < audioTracks.length; k++) {
            var aItem = audioTracks[k];
            var aUrl = aItem.baseUrl || aItem.url || "";
            if (!aUrl || seenUrls[aUrl]) continue;
            seenUrls[aUrl] = true;

            var aLang = formatLanguageCode(aItem);
            var aAuto = aItem.kind === "asr" || (aItem.vssId && (aItem.vssId.indexOf("a.") === 0 || aItem.vssId.indexOf("a:") === 0));
            var aName = formatTrackDisplayName(aItem);

            tracks.push({
              id: "yt_audio_" + k + "_" + aLang,
              name: aName,
              languageCode: aLang,
              baseUrl: aUrl,
              vssId: aItem.vssId,
              kind: aItem.kind,
              isAutoGenerated: !!aAuto
            });
          }
        }
      } catch (e) {}
    }

    // 7. Synthesize Auto-translate Japanese if no native Japanese exists
    var hasJa = tracks.some(function(t) {
      return t.languageCode === "ja" ||
        t.languageCode.indexOf("ja") === 0 ||
        (t.name && (t.name.indexOf("日本語") !== -1 || t.name.indexOf("Japanese") !== -1));
    });

    if (!hasJa && tracks.length > 0) {
      var baseTrack = null;
      for (var b = 0; b < tracks.length; b++) {
        if (!tracks[b].isAutoGenerated && tracks[b].baseUrl) {
          baseTrack = tracks[b];
          break;
        }
      }
      if (!baseTrack) baseTrack = tracks[0];

      if (baseTrack && baseTrack.baseUrl) {
        var autoJaUrl = baseTrack.baseUrl;
        if (autoJaUrl.indexOf("tlang=") !== -1) {
          autoJaUrl = autoJaUrl.replace(/tlang=[^&]+/, "tlang=ja");
        } else {
          autoJaUrl = autoJaUrl.indexOf("?") !== -1 ? autoJaUrl + "&tlang=ja" : autoJaUrl + "?tlang=ja";
        }

        tracks.unshift({
          id: "yt_auto_translate_ja",
          name: "日本語 (" + baseTrack.name + " - Auto Translate)",
          languageCode: "ja",
          baseUrl: autoJaUrl,
          vssId: ".ja",
          kind: "asr",
          isAutoGenerated: true
        });
      }
    }

    return tracks;
  }

  function broadcastTracks() {
    try {
      var tracks = getPlayerCaptionTracks();
      var videoId = extractCurrentVideoId();
      window.dispatchEvent(
        new CustomEvent("hakkutsu:bridge-tracks", {
          detail: { videoId: videoId, tracks: tracks }
        })
      );
    } catch (err) {
      console.warn("[Hakkutsu Main Bridge] Error broadcasting tracks:", err);
    }
  }

  // Handle in-page fetch requests carrying YouTube PO-tokens and cookies
  function handleFetchTimedtextRequest(e) {
    var detail = e.detail || {};
    var requestId = detail.requestId;
    var url = detail.url;
    if (!requestId || !url) return;

    window.fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    })
    .then(function(response) {
      if (!response.ok) {
        window.dispatchEvent(
          new CustomEvent("hakkutsu:bridge-timedtext-response", {
            detail: {
              requestId: requestId,
              success: false,
              status: response.status,
              error: "HTTP " + response.status
            }
          })
        );
        return;
      }
      return response.text().then(function(text) {
        window.dispatchEvent(
          new CustomEvent("hakkutsu:bridge-timedtext-response", {
            detail: {
              requestId: requestId,
              success: true,
              status: response.status,
              text: text
            }
          })
        );
      });
    })
    .catch(function(err) {
      window.dispatchEvent(
        new CustomEvent("hakkutsu:bridge-timedtext-response", {
          detail: {
            requestId: requestId,
            success: false,
            error: err ? (err.message || String(err)) : "Fetch error"
          }
        })
      );
    });
  }

  // Register bridge listeners
  window.addEventListener("hakkutsu:request-bridge-tracks", function() {
    broadcastTracks();
  });

  window.addEventListener("hakkutsu:fetch-timedtext-request", handleFetchTimedtextRequest);



  // Auto-broadcast on navigation events
  window.addEventListener("yt-navigate-finish", function() {
    setTimeout(broadcastTracks, 200);
    setTimeout(broadcastTracks, 1000);
  });
  window.addEventListener("yt-page-data-updated", function() {
    setTimeout(broadcastTracks, 300);
  });
  window.addEventListener("popstate", function() {
    setTimeout(broadcastTracks, 300);
  });

  // Initial broadcast
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      setTimeout(broadcastTracks, 400);
    });
  } else {
    setTimeout(broadcastTracks, 200);
  }

  var checks = 0;
  var timer = setInterval(function() {
    checks++;
    var player = document.querySelector("#movie_player");
    if (player || checks > 20) {
      broadcastTracks();
      if (player || checks > 20) clearInterval(timer);
    }
  }, 400);
})();
`;

/**
 * Inject the main-world bridge script directly into YouTube's DOM (Main World).
 */
export function injectMainWorldBridge(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(MAIN_BRIDGE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = MAIN_BRIDGE_SCRIPT_ID;
  script.textContent = MAIN_BRIDGE_SCRIPT_CONTENT;
  (document.head || document.documentElement).appendChild(script);
}
