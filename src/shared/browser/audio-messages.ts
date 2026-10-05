import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleAudioMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "FETCH_TTS_AUDIO": {
      const { text, lang = "ja" } = message.payload as {
        text: string;
        lang?: string;
      };
      try {
        const cleanText = text.trim().slice(0, 200);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(cleanText)}`;
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(`Google TTS fetch returned status ${res.status}`);
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
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
