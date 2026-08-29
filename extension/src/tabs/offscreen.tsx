import { createWorker } from "tesseract.js";

const workersMap = new Map<string, Promise<any>>();

function resolveLang(language?: string): string {
  if (!language || language === "auto") return "jpn+jpn_vert";
  if (language === "horizontal" || language === "jpn") return "jpn";
  if (language === "vertical" || language === "jpn_vert") return "jpn_vert";
  return language;
}

async function getWorker(language: string = "jpn") {
  const langKey = resolveLang(language);
  if (!workersMap.has(langKey)) {
    const workerPromise = (async () => {
      const workerPath = chrome.runtime.getURL("assets/tesseract/worker.min.js");
      const corePath = chrome.runtime.getURL("assets/tesseract/core/");
      const langPath = chrome.runtime.getURL("assets/tesseract/tessdata/");

      try {
        console.log(`[OCR Engine] Initializing worker (${langKey})...`);
        const worker = await createWorker(langKey, 1, {
          workerPath,
          corePath,
          langPath,
          workerBlobURL: false,
          logger: (m) => {
            if (m.status) {
              console.log(`[OCR Engine] [${langKey}] ${m.status}: ${Math.round((m.progress || 0) * 100)}%`);
            }
          }
        });
        return worker;
      } catch (err) {
        console.error(`[OCR Engine Init Error] (${langKey})`, err);
        workersMap.delete(langKey);
        throw err;
      }
    })();
    workersMap.set(langKey, workerPromise);
  }
  return workersMap.get(langKey)!;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_OFFSCREEN_OCR") {
    (async () => {
      try {
        const { dataUrl, language } = (message.payload as { dataUrl: string; language?: string }) || {};
        if (!dataUrl) {
          throw new Error("No image data provided for OCR.");
        }

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Quét chữ OCR hết thời gian chờ, vui lòng thử lại.")), 45000)
        );

        const ocrPromise = (async () => {
          const worker = await getWorker(language);
          const { data } = await worker.recognize(dataUrl);
          return (data.text || "").trim();
        })();

        const fullText = await Promise.race([ocrPromise, timeoutPromise]);
        sendResponse({ type: "OFFSCREEN_OCR_RESULT", payload: { text: fullText } });
      } catch (err: any) {
        console.error("[OCR Engine Error]", err);
        sendResponse({
          type: "OFFSCREEN_OCR_ERROR",
          payload: { error: err?.message || String(err) }
        });
      }
    })();
    return true; // Keep channel open for async response
  }
});

export default function OffscreenPage() {
  return null;
}
