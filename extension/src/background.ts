/**
 * Background service worker.
 *
 * Routes messages between content scripts and services,
 * manages extension state and API proxying.
 */

import { getSettings } from "~services/storage";
import { apiClient } from "~services/api-client";
import { localSrs } from "~services/local-srs";
import { ankiClient } from "~services/anki-connect";
import { localOcrService } from "~services/ocr-service";
import {
  fetchCaptionTracks,
  fetchSubtitles,
  fetchSubtitlesFromPlayerResponse,
  extractCaptionTracks,
  extractVideoId,
} from "~services/subtitle-fetcher";
import type {
  ExtensionMessage,
  AnalyzeRequest,
  AnkiExportData,
  AnalyzeResponse,
  SubtitleResponse,
  TokenAnalysis,
  DictionaryEntry
} from "~types";
import { tokenize } from "~services/nlp/local-tokenizer";
import { searchDictionary } from "~services/dictionary/local-lookup";

// Removed backend fallback logic since backend is now deprecated

// Fallback logic for when the local backend is offline
async function fetchFromJisho(text: string): Promise<AnalyzeResponse> {
  const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Jisho API failed");
  const json = await res.json();
  
  if (!json.data || json.data.length === 0) {
    throw new Error("No results found in public dictionary");
  }

  const data = json.data;
  const mainEntry = data[0];
  
  return {
    text,
    sentence_reading: mainEntry.japanese?.[0]?.reading || "",
    token_count: 1,
    difficulty_score: null,
    difficulty_label: null,
    tokens: [
      {
        surface: text,
        dictionary_form: mainEntry.japanese?.[0]?.word || mainEntry.slug || text,
        pos: mainEntry.senses?.[0]?.parts_of_speech?.[0] || "Unknown",
        pos_detail: [],
        reading: {
          hiragana: mainEntry.japanese?.[0]?.reading || "",
          romaji: ""
        },
        is_japanese: true,
        frequency_rank: mainEntry.is_common ? 1 : undefined,
        jlpt_level: mainEntry.jlpt?.length ? mainEntry.jlpt[0].replace(/jlpt-/i, "").toUpperCase() : null,
        definitions: data.slice(0, 3).map((d: any) => ({
          dictionary: "Jisho",
          glosses: d.senses.flatMap((s: any) => s.english_definitions)
        }))
      }
    ]
  };
}

async function analyzeLocal(text: string): Promise<AnalyzeResponse> {
  const tokens = await tokenize(text);
  
  const tokenAnalyses: TokenAnalysis[] = await Promise.all(tokens.map(async (t) => {
    const is_japanese = /[ぁ-んァ-ン一-龯]/.test(t.surface_form);
    let definitions: DictionaryEntry[] = [];
    let jlpt_level: string | null = null;
    
    if (is_japanese && t.base_form) {
      const dictEntries = await searchDictionary(t.base_form);
      if (dictEntries && dictEntries.length > 0) {
        const mainEntry = dictEntries[0];
        jlpt_level = mainEntry.jlpt || null;
        definitions = mainEntry.senses.map(s => ({
          dictionary: "JMdict",
          glosses: s.glosses,
          pos: s.partOfSpeech,
          field: null,
          misc: []
        }));
      }
    }
    
    return {
      surface: t.surface_form,
      dictionary_form: t.base_form,
      pos: t.pos,
      pos_detail: [],
      reading: {
        hiragana: t.reading || "",
        romaji: ""
      },
      is_japanese,
      jlpt_level,
      frequency_rank: null,
      definitions
    };
  }));

  return {
    text,
    tokens: tokenAnalyses,
    sentence_reading: "",
    token_count: tokens.length,
    difficulty_score: null,
    difficulty_label: null
  };
}

// Initialize API client with stored settings
async function initializeApiClient(): Promise<void> {
  apiClient.setBaseUrl("http://localhost:8000");
}

initializeApiClient();

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          type: "ERROR" as const,
          payload: { error: error.message },
        })
      );

    // Return true to indicate we'll respond asynchronously
    return true;
  }
);

async function playerResponseFromTab(
  tabId: number
): Promise<Record<string, unknown> | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const url = window.location.href;
      const vMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
      const currentVideoId = vMatch ? vMatch[1] : null;
      if (!currentVideoId) return null;

      const candidates: any[] = [];
      const moviePlayer = document.querySelector("#movie_player") as any;
      if (typeof moviePlayer?.getPlayerResponse === "function") {
        try {
          candidates.push(moviePlayer.getPlayerResponse());
        } catch {
          // Player can be between states during YouTube SPA navigation.
        }
      }
      candidates.push((window as any).ytInitialPlayerResponse);
      const raw = (window as any).ytplayer?.config?.args?.raw_player_response;
      if (raw) {
        try {
          candidates.push(JSON.parse(raw));
        } catch {
          // Ignore malformed legacy player config.
        }
      }

      const response = candidates.find(
        (candidate) => candidate?.videoDetails?.videoId === currentVideoId
      ) || candidates[0];
      if (!response) return null;

      let runtimeTracks: any[] = [];
      if (typeof moviePlayer?.getOption === "function") {
        try {
          const list = moviePlayer.getOption("captions", "tracklist");
          if (Array.isArray(list) && list.length > 0) {
            runtimeTracks = list.map((track: any) => ({
              baseUrl: track.baseUrl || track.url || "",
              languageCode: track.languageCode || (typeof track.vssId === "string" ? track.vssId.replace(/^[a-z]\./, "") : "") || "",
              name: track.name || track.displayName || track.languageName || track.languageCode || "",
              kind: track.kind || "",
              vssId: track.vssId || "",
            }));
          }
        } catch {
          // Ignore
        }
      }

      if (runtimeTracks.length === 0 && typeof moviePlayer?.getAudioTrack === "function") {
        try {
          const tracks = moviePlayer.getAudioTrack()?.captionTracks;
          if (Array.isArray(tracks)) {
            runtimeTracks = tracks.map((track: any) => ({
              baseUrl: track.baseUrl || track.url || "",
              languageCode: track.languageCode || "",
              name: track.name || track.displayName || track.languageName || track.languageCode || "",
              kind: track.kind || "",
              vssId: track.vssId || "",
            }));
          }
        } catch {
          // Ignore
        }
      }

      const captions = runtimeTracks.length
        ? {
            playerCaptionsTracklistRenderer: {
              ...(response.captions?.playerCaptionsTracklistRenderer || {}),
              captionTracks: runtimeTracks,
            },
          }
        : response.captions;

      return {
        videoDetails: response.videoDetails || { videoId: currentVideoId },
        captions,
      };
    },
  });
  const result = results[0]?.result;
  return result && typeof result === "object"
    ? result as Record<string, unknown>
    : null;
}

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzeJavi(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch {
        try {
          const result = await apiClient.analyzeText(request);
          return { type: "ANALYZE_RESULT", payload: result };
        } catch (err) {
          console.warn("Backend analysis failed, falling back to local for", request.text, err);
          const fallbackResult = await analyzeLocal(request.text);
          return { type: "ANALYZE_RESULT", payload: fallbackResult };
        }
      }
    }

    case "ANALYZE_JAVI": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzeJavi(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch {
        const result = await apiClient.analyzeText(request);
        return { type: "ANALYZE_RESULT", payload: result };
      }
    }

    case "ANALYZE_PHRASE": {
      const request = message.payload as AnalyzeRequest;
      const result = await apiClient.analyzePhrase(request);
      return { type: "ANALYZE_PHRASE_RESULT", payload: result };
    }


    case "GET_SUBTITLES": {
      const { videoUrl, language, playerResponse, strategy = "all" } = message.payload as {
        videoUrl: string;
        language?: string;
        playerResponse?: Record<string, unknown> | null;
        strategy?: "youtube" | "backend" | "all";
      };
      const targetLanguage = language || "ja";
      const youtubeFailures: string[] = [];
      let currentPlayerResponse = playerResponse;
      let sourceTabId = sender?.tab?.id;

      if (strategy !== "backend" && !currentPlayerResponse && sourceTabId == null) {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (
          activeTab?.id != null &&
          activeTab.url &&
          extractVideoId(activeTab.url) === extractVideoId(videoUrl)
        ) {
          sourceTabId = activeTab.id;
        }
      }

      if (strategy !== "backend" && !currentPlayerResponse && sourceTabId != null) {
        try {
          currentPlayerResponse = await playerResponseFromTab(sourceTabId);
        } catch (error) {
          youtubeFailures.push(
            `read current player: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (strategy !== "backend" && currentPlayerResponse) {
        try {
          const videoId = new URL(videoUrl).searchParams.get("v");
          if (!videoId) throw new Error("Current YouTube URL has no video id.");
          const subtitleResult = await fetchSubtitlesFromPlayerResponse(
            currentPlayerResponse,
            videoId,
            targetLanguage
          );
          return { type: "SUBTITLES_RESULT", payload: subtitleResult };
        } catch (error) {
          youtubeFailures.push(
            `current player: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (strategy !== "backend") {
        try {
          const subtitleResult = await fetchSubtitles(videoUrl, targetLanguage);
          return { type: "SUBTITLES_RESULT", payload: subtitleResult };
        } catch (error) {
          youtubeFailures.push(
            `fresh YouTube page: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (strategy === "youtube") {
        throw new Error(`YouTube direct failed (${youtubeFailures.join("; ")})`);
      }

      throw new Error(`YouTube direct failed (${youtubeFailures.join("; ")})`);
    }

    case "GET_CAPTION_TRACKS": {
      const { videoUrl: trackUrl } = message.payload as { videoUrl: string };
      if (sender?.tab?.id != null) {
        try {
          const currentPlayerResponse = await playerResponseFromTab(sender.tab.id);
          if (currentPlayerResponse) {
            const tracks = extractCaptionTracks(currentPlayerResponse);
            return { type: "CAPTION_TRACKS_RESULT", payload: { tracks } };
          }
        } catch {
          // Fall through to a fresh YouTube page request.
        }
      }
      const tracks = await fetchCaptionTracks(trackUrl);
      return { type: "CAPTION_TRACKS_RESULT", payload: { tracks } };
    }

    case "TEXT_SELECTED":
      // Handled by popup if open. We just return success to avoid background errors.
      return { type: "IGNORED", payload: {} };

    case "EXPORT_ANKI": {
      const data = message.payload as AnkiExportData;
      const settings = await getSettings();
      const noteId = await ankiClient.exportVocabulary(
        data,
        settings.ankiDeck,
        settings.ankiModel
      );
      return { type: "ANKI_RESULT", payload: { noteId } };
    }

    case "ADD_SRS_CARD": {
      // In a real app we'd get user_id from auth, for now we hardcode "user_1"
      const data = message.payload as { word: string; reading?: string; meaning?: string; sentence?: string };
      const card = await localSrs.addSrsCard(data);
      return { type: "SRS_RESULT", payload: card };
    }


    case "CHECK_ANKI": {
      const connected = await ankiClient.isConnected();
      return { type: "ANKI_STATUS", payload: { connected } };
    }

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { type: "GET_SETTINGS", payload: settings };
    }

    case "CAPTURE_SCREENSHOT": {
      return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(
          chrome.windows.WINDOW_ID_CURRENT,
          { format: "png" },
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve({ type: "SCREENSHOT_RESULT", payload: { dataUrl } });
            }
          }
        );
      });
    }

    case "FETCH_IMAGE": {
      const { url } = message.payload as { url: string };
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return { type: "FETCH_IMAGE_RESULT", payload: { dataUrl } };
      } catch (err: any) {
        throw new Error(`Failed to fetch image: ${err.message || err}`);
      }
    }

    case "TRANSLATE_TEXT": {
      const { texts } = message.payload as { texts: string[] };

      // Infallible fallback: Free Google Translate
      const translations = await Promise.all(
        texts.map(async (t) => {
          try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(t.trim())}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data[0]) {
                return data[0].map((item: any) => item[0]).filter(Boolean).join("");
              }
            }
          } catch {
            // ignore
          }
          return "";
        })
      );

      return {
        type: "TRANSLATE_RESULT",
        payload: {
          source_language: "ja",
          target_language: "vi",
          translations,
          items: texts.map((t, idx) => ({
            index: idx,
            source: t,
            translation: translations[idx] || "",
            tokens: [],
          })),
        },
      };
    }

    case "OCR_IMAGE": {
      const { image_data, language } = message.payload as { image_data: string; language?: string };
      const settings = await getSettings();
      
      if (settings.localOcrEnabled) {
        try {
          const text = await localOcrService.recognizeImage(image_data);
          return {
            type: "OCR_RESULT",
            payload: {
              full_text: text,
              regions: [{ text, confidence: 1.0, bbox: null }],
              language: language || "jpn"
            }
          };
        } catch (error: any) {
          throw new Error(`Local OCR failed: ${error.message}`);
        }
      }

      throw new Error(`Bạn cần bật tính năng 'Local OCR' trong Cài đặt để sử dụng.`);
    }

    case "OPEN_APP": {
      chrome.tabs.create({ url: chrome.runtime.getURL("tabs/app.html") });
      return { type: "OPEN_APP_RESULT", payload: {} };
    }

    default:
      return { type: "ERROR", payload: { error: `Unknown message type: ${message.type}` } };
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "start-ocr") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "START_SCREENSHOT_FLOW" });
      }
    });
  }
});

export {};
