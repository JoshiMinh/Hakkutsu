import { createWorker } from "tesseract.js";

let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const workerPath = chrome.runtime.getURL("assets/tesseract/worker.min.js");
      const corePath = chrome.runtime.getURL("assets/tesseract/core/");
      const langPath = "https://tessdata.projectnaptha.com/4.0.0";

      try {
        console.log("[Offscreen OCR] Initializing Tesseract worker with local extension assets...");
        const worker = await createWorker("jpn", 1, {
          workerPath,
          corePath,
          langPath,
          workerBlobURL: false,
          logger: (m) => {
            if (m.status) {
              console.log(`[Offscreen OCR] ${m.status}: ${Math.round((m.progress || 0) * 100)}%`);
            }
          }
        });
        return worker;
      } catch (err) {
        console.error("[Offscreen OCR Init Error]", err);
        workerPromise = null;
        throw err;
      }
    })();
  }
  return workerPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_OFFSCREEN_OCR") {
    (async () => {
      try {
        const { dataUrl } = (message.payload as { dataUrl: string }) || {};
        if (!dataUrl) {
          throw new Error("No image data provided for OCR.");
        }

        // 35-second timeout for local OCR language data download & recognition
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Local OCR timed out (check internet connection for language download)")), 35000)
        );

        const ocrPromise = (async () => {
          const worker = await getWorker();
          const { data } = await worker.recognize(dataUrl);
          return (data.text || "").trim();
        })();

        const fullText = await Promise.race([ocrPromise, timeoutPromise]);
        sendResponse({ type: "OFFSCREEN_OCR_RESULT", payload: { text: fullText } });
      } catch (err: any) {
        console.error("[Offscreen OCR Error]", err);
        workerPromise = null; // Reset worker so retries can attempt fresh init
        sendResponse({
          type: "OFFSCREEN_OCR_ERROR",
          payload: { error: err?.message || String(err) }
        });
      }
    })();
    return true; // Keep channel open for async response
  }
});
