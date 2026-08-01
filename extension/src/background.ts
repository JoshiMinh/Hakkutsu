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

async function fetchSubtitlesFromLocalBackend(
  videoUrl: string,
  language: string,
): Promise<SubtitleResponse> {
  const settings = await getSettings();
  const baseUrls = [
    settings.backendUrl,
    "http://127.0.0.1:8000",
    "http://localhost:8000",
  ]
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);

  const failures: string[] = [];
  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}/api/v1/subtitles/youtube`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: videoUrl, language }),
      });
      if (!response.ok) {
        failures.push(`${baseUrl}: HTTP ${response.status}`);
        continue;
      }

      const result = (await response.json()) as SubtitleResponse;
      if (Array.isArray(result.segments) && result.segments.length > 0) {
        return result;
      }
      failures.push(`${baseUrl}: không có đoạn phụ đề`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${baseUrl}: ${message}`);
    }
  }

  throw new Error(`Backend phụ đề local không khả dụng (${failures.join("; ")})`);
}

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
  const settings = await getSettings();
  apiClient.setBaseUrl(settings.backendUrl);
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
      const currentVideoId = new URL(window.location.href).searchParams.get("v");
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
      );
      if (!response) return null;

      // The initialized player may expose runtime-only caption parameters
      // (notably `pot`) that are absent from ytInitialPlayerResponse.
      let runtimeTracks: any[] = [];
      if (typeof moviePlayer?.getAudioTrack === "function") {
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
          // Player can still be initializing the audio track.
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
        videoDetails: response.videoDetails,
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
        const result = await analyzeLocal(request.text);
        return { type: "ANALYZE_RESULT", payload: result };
      } catch (err) {
        console.warn("Local analysis failed, falling back to Jisho API for", request.text, err);
        const fallbackResult = await fetchFromJisho(request.text);
        return { type: "ANALYZE_RESULT", payload: fallbackResult };
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
      const targetLanguage = language || "auto";
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

      try {
        const backendResult = await fetchSubtitlesFromLocalBackend(videoUrl, targetLanguage);
        return {
          type: "SUBTITLES_RESULT",
          payload: {
            videoId: backendResult.video_id,
            language: backendResult.language,
            segments: backendResult.segments,
            fullText: backendResult.full_text,
            trackName: backendResult.track_name || "Local backend caption fallback",
            isAutoGenerated: backendResult.is_auto_generated ?? false,
            source: "backend",
          },
        };
      } catch (error) {
        const backendMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `YouTube subtitle failed (${youtubeFailures.join("; ")}). ${backendMessage}`
        );
      }
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
