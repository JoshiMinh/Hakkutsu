import { createWorker } from "tesseract.js";

let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(["jpn", "jpn_vert"]);
      return worker;
    })();
  }
  return workerPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_OFFSCREEN_OCR") {
    (async () => {
      try {
        const worker = await getWorker();
        const { dataUrl } = (message.payload as { dataUrl: string }) || {};
        if (!dataUrl) {
          throw new Error("No image data provided for OCR.");
        }
        const { data } = await worker.recognize(dataUrl);
        const fullText = (data.text || "").trim();
        sendResponse({ type: "OFFSCREEN_OCR_RESULT", payload: { text: fullText } });
      } catch (err: any) {
        sendResponse({ type: "OFFSCREEN_OCR_ERROR", payload: { error: err?.message || String(err) } });
      }
    })();
    return true; // Keep channel open for async response
  }
});

