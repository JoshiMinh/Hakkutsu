import { SUPPORTED_LANGUAGES, getLanguageConfig } from "~lib/languages";

/**
 * High-Quality Text-to-Speech (TTS) Service for Hakkutsu.
 * Uses Google Translate natural neural voice via extension background proxy
 * (immune to page CSP and CORS restrictions), with browser SpeechSynthesis as fallback.
 */
class TtsService {
  private currentAudio: HTMLAudioElement | null = null;

  /**
   * Stop any ongoing speech synthesis or audio playback.
   */
  stop(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // Ignore
      }
      this.currentAudio = null;
    }

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Play natural speech for Japanese text using Google Translate TTS.
   */
  playJapanese(text: string): void {
    this.play(text, "ja", "ja-JP");
  }

  /**
   * Play natural speech for target language translation (e.g. 'vi', 'en', etc.).
   */
  playTargetLanguage(text: string, targetLang: string = "vi"): void {
    const config = getLanguageConfig(targetLang);
    this.play(
      text, 
      config.googleTranslateCode || targetLang || "vi", 
      config.ttsLangCode || "vi-VN"
    );
  }

  /**
   * Primary: Google Translate natural neural voice fetched via background service.
   * Secondary: Direct Google Translate Audio URL.
   * Tertiary Fallback: Browser Web Speech API.
   */
  async play(text: string, googleLangCode: string = "ja", fallbackTtsLocale: string = "ja-JP"): Promise<void> {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    this.stop();

    // 1. Try background proxy for Google Translate TTS (bypasses webpage CSP/CORS)
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "FETCH_TTS_AUDIO",
          payload: { text: cleanText, lang: googleLangCode }
        });

        if (response?.payload?.dataUrl) {
          const audio = new Audio(response.payload.dataUrl);
          this.currentAudio = audio;
          await audio.play();
          return;
        }
      } catch (e) {
        console.warn("[Hakkutsu TTS] Background proxy failed, trying direct audio:", e);
      }
    }

    // 2. Direct Google Translate TTS URL
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
      googleLangCode
    )}&q=${encodeURIComponent(cleanText.slice(0, 200))}`;

    try {
      const audio = new Audio(googleTtsUrl);
      this.currentAudio = audio;

      audio.onerror = () => {
        console.warn("[Hakkutsu TTS] Direct Google TTS failed, using browser SpeechSynthesis fallback.");
        this.playBrowserSpeechFallback(cleanText, fallbackTtsLocale);
      };

      await audio.play();
    } catch (err) {
      console.warn("[Hakkutsu TTS] Audio playback rejected, using browser fallback:", err);
      this.playBrowserSpeechFallback(cleanText, fallbackTtsLocale);
    }
  }

  /**
   * Offline browser speech synthesis fallback.
   */
  private playBrowserSpeechFallback(text: string, ttsLocale: string): void {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = ttsLocale;
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.error("[Hakkutsu TTS] Browser SpeechSynthesis failed:", err);
    }
  }
}

export const ttsService = new TtsService();

