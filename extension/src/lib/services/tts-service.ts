/**
 * High-Quality Text-to-Speech (TTS) Service for Hakkutsu.
 * Prioritizes Google Translate TTS natural neural voices for Japanese learning
 * and Target Language audio, with browser SpeechSynthesis as an offline fallback.
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
   * Play natural speech for target language translation (e.g. 'vi', 'en').
   */
  playTargetLanguage(text: string, targetLang: string = "vi"): void {
    const localeMap: Record<string, { googleCode: string; ttsLocale: string }> = {
      vi: { googleCode: "vi", ttsLocale: "vi-VN" },
      en: { googleCode: "en", ttsLocale: "en-US" },
    };
    const config = localeMap[targetLang] || { googleCode: targetLang || "vi", ttsLocale: "vi-VN" };
    this.play(text, config.googleCode, config.ttsLocale);
  }

  /**
   * Primary: Google Translate TTS natural audio.
   * Secondary Fallback: Browser Web Speech API.
   */
  play(text: string, googleLangCode: string = "ja", fallbackTtsLocale: string = "ja-JP"): void {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    this.stop();

    // Google Translate TTS URL
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
      googleLangCode
    )}&q=${encodeURIComponent(cleanText.slice(0, 200))}`;

    const audio = new Audio(googleTtsUrl);
    this.currentAudio = audio;

    let fallbackTriggered = false;
    const triggerFallback = () => {
      if (fallbackTriggered) return;
      fallbackTriggered = true;
      this.playBrowserSpeechFallback(cleanText, fallbackTtsLocale);
    };

    audio.onerror = () => {
      console.warn("[Hakkutsu] Google TTS failed, falling back to browser SpeechSynthesis.");
      triggerFallback();
    };

    audio.play().catch((err) => {
      console.warn("[Hakkutsu] Audio play rejected:", err);
      triggerFallback();
    });
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
      console.error("[Hakkutsu] Browser SpeechSynthesis failed:", err);
    }
  }
}

export const ttsService = new TtsService();
