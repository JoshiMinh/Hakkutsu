/**
 * Background service worker.
 *
 * Routes messages between content scripts and services,
 * manages extension state and API proxying.
 */

import { getSettings } from "~lib/services/storage";
import { apiClient } from "~lib/services/api-client";
import { localSrs } from "~lib/services/local-srs";
import { ankiClient } from "~lib/services/anki-connect";
import { localOcrService } from "~lib/services/ocr-service";
import {
  fetchCaptionTracks,
  fetchSubtitles,
  fetchSubtitlesFromPlayerResponse,
  extractCaptionTracks,
  extractVideoId,
} from "~lib/services/subtitle-fetcher";
import type {
  ExtensionMessage,
  AnalyzeRequest,
  AnkiExportData,
  AnalyzeResponse,
  SubtitleResponse,
  TokenAnalysis,
  DictionaryEntry
} from "~lib/types";
import { tokenize } from "~lib/services/local-tokenizer";
import { searchDictionary } from "~lib/services/local-lookup";

// Removed backend fallback logic since backend is now deprecated

import { getHanViet } from "~lib/utils/hanviet-dict";
import { lookupWord } from "~lib/services/dictionary-lookup";
import { katakanaToHiragana } from "~lib/utils/japanese";

// Fallback logic for public dictionary lookups
async function fetchDictionaryFallback(text: string): Promise<AnalyzeResponse> {
  const settings = await getSettings();
  const targetLang = settings.targetLanguage || "vi";
  const info = await lookupWord(text, targetLang);
  const isVietnamese = targetLang === "vi";

  return {
    text,
    sentence_reading: info.reading || text,
    token_count: 1,
    difficulty_score: null,
    difficulty_label: null,
    tokens: [
      {
        surface: text,
        dictionary_form: text,
        pos: "Word",
        pos_detail: [],
        reading: { hiragana: info.reading || "", romaji: "" },
        is_japanese: true,
        jlpt_level: info.jlpt || null,
        frequency_rank: null,
        vietnamese_sound: isVietnamese ? (info.hanviet || getHanViet(text)) : undefined,
        definitions: info.meaning ? [{ dictionary: info.source || "Dict", glosses: [info.meaning], pos: ["Word"], field: null, misc: [] }] : []
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
    
    const hiraganaReading = t.reading ? katakanaToHiragana(t.reading) : (is_japanese ? t.surface_form : "");

    return {
      surface: t.surface_form,
      dictionary_form: t.base_form,
      pos: t.pos,
      pos_detail: [],
      reading: {
        hiragana: hiraganaReading,
        romaji: ""
      },
      is_japanese,
      jlpt_level,
      frequency_rank: null,
      definitions
    };
  }));

  const sentence_reading = tokenAnalyses.map((t) => t.reading.hiragana || t.surface).join("");

  return {
    text,
    tokens: tokenAnalyses,
    sentence_reading,
    token_count: tokens.length,
    difficulty_score: null,
    difficulty_label: null
  };
}



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

      const formatTrackName = (t: any): string => {
        if (typeof t.name === "string") return t.name;
        if (t.name?.simpleText) return t.name.simpleText;
        if (Array.isArray(t.name?.runs)) return t.name.runs.map((r: any) => r.text || "").join("");
        if (typeof t.displayName === "string") return t.displayName;
        if (typeof t.languageName === "string") return t.languageName;
        if (typeof t.languageCode === "string") return t.languageCode;
        return "";
      };

      const formatLanguageCode = (t: any): string => {
        if (typeof t.languageCode === "string" && t.languageCode) {
          return t.languageCode.toLowerCase().replace(/^\./, "").replace(/^a\./, "");
        }
        if (typeof t.vssId === "string" && t.vssId) {
          return t.vssId.toLowerCase().replace(/^\.?[a-z0-9_-]*\./i, "").replace(/^\./, "");
        }
        return "";
      };

      // 1. First priority: playerResponse or ytInitialPlayerResponse captionTracks (contains full signed baseUrl)
      let captionTracks =
        response.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        response.captions?.playerCaptionsRenderer?.captionTracks;

      // 2. If existing tracks have baseUrl, keep them
      if (Array.isArray(captionTracks) && captionTracks.some((t: any) => t.baseUrl || t.url)) {
        return {
          videoDetails: response.videoDetails || { videoId: currentVideoId },
          captions: response.captions,
        };
      }

      let runtimeTracks: any[] = [];
      if (typeof moviePlayer?.getOption === "function") {
        try {
          const list = moviePlayer.getOption("captions", "tracklist");
          if (Array.isArray(list) && list.length > 0) {
            runtimeTracks = list
              .filter((track: any) => track.baseUrl || track.url)
              .map((track: any) => ({
                baseUrl: track.baseUrl || track.url || "",
                languageCode: formatLanguageCode(track),
                name: formatTrackName(track),
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
            runtimeTracks = tracks
              .filter((track: any) => track.baseUrl || track.url)
              .map((track: any) => ({
                baseUrl: track.baseUrl || track.url || "",
                languageCode: formatLanguageCode(track),
                name: formatTrackName(track),
                kind: track.kind || "",
                vssId: track.vssId || "",
              }));
          }
        } catch {
          // Ignore
        }
      }

      const captions = runtimeTracks.length > 0
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
    ? (result as Record<string, unknown>)
    : null;
}

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "ANALYZE_TEXT":
    case "ANALYZE_JAVI": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzePhrase(request);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch (llmErr) {
        console.warn("[Hakkutsu] LLM analysis unavailable, trying dictionary fallback:", llmErr);
        try {
          const dictResult = await fetchDictionaryFallback(request.text);
          return { type: "ANALYZE_RESULT", payload: dictResult };
        } catch (dictErr) {
          console.warn("[Hakkutsu] Dictionary lookup failed, using local tokenizer:", dictErr);
          try {
            const fallbackResult = await analyzeLocal(request.text);
            return { type: "ANALYZE_RESULT", payload: fallbackResult };
          } catch {
            return {
              type: "ANALYZE_RESULT",
              payload: {
                text: request.text,
                sentence_reading: "",
                token_count: 1,
                difficulty_score: null,
                difficulty_label: null,
                tokens: [
                  {
                    surface: request.text,
                    dictionary_form: request.text,
                    pos: "Word",
                    pos_detail: [],
                    reading: { hiragana: "", romaji: "" },
                    is_japanese: true,
                    jlpt_level: null,
                    frequency_rank: null,
                    definitions: []
                  }
                ]
              }
            };
          }
        }
      }
    }

    case "ANALYZE_PHRASE": {
      const request = message.payload as AnalyzeRequest;
      try {
        const result = await apiClient.analyzePhrase(request);
        return { type: "ANALYZE_PHRASE_RESULT", payload: result };
      } catch (err) {
        console.warn("[Hakkutsu] Phrase LLM analysis failed, fallback to dictionary:", err);
        try {
          const dictResult = await fetchDictionaryFallback(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: {
              ...dictResult,
              translation: dictResult.tokens[0]?.definitions?.[0]?.glosses?.slice(0, 3).join(", ") || ""
            }
          };
        } catch {
          const fallbackResult = await analyzeLocal(request.text);
          return {
            type: "ANALYZE_PHRASE_RESULT",
            payload: { ...fallbackResult, translation: "" }
          };
        }
      }
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

    case "FETCH_TTS_AUDIO": {
      const { text, lang = "ja" } = message.payload as { text: string; lang?: string };
      try {
        const cleanText = text.trim().slice(0, 200);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(cleanText)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Google TTS fetch returned status ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:audio/mpeg;base64,${base64}`;
        return { type: "TTS_AUDIO_RESULT", payload: { dataUrl } };
      } catch (err: any) {
        console.warn("[Hakkutsu Background] TTS audio fetch error:", err);
        throw new Error(`Failed to fetch TTS audio: ${err.message || err}`);
      }
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

    case "FETCH_TIMEDTEXT_URL": {
      const { url } = message.payload as { url: string };
      try {
        let res = await fetch(url, {
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
        });
        if (!res.ok && !url.includes("fmt=")) {
          const jsonUrl = url.includes("?") ? `${url}&fmt=json3` : `${url}?fmt=json3`;
          res = await fetch(jsonUrl, {
            headers: {
              Accept: "application/json, text/plain, */*",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            },
          });
        }
        if (res.ok) {
          const text = await res.text();
          return { type: "FETCH_TIMEDTEXT_RESULT", payload: { success: true, text } };
        }
        return { type: "FETCH_TIMEDTEXT_RESULT", payload: { success: false, error: `HTTP ${res.status}` } };
      } catch (err: any) {
        return { type: "FETCH_TIMEDTEXT_RESULT", payload: { success: false, error: String(err) } };
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
      chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
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
