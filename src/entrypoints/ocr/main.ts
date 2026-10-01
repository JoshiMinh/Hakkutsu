import { ocrEngine, type OcrOrientation } from "~lib/services/ocr-engine";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_MANGA_OCR_OFFSCREEN") return;

  const { imageDataUrl, orientation, boxWidth, boxHeight } = message.payload as {
    imageDataUrl: string;
    orientation: OcrOrientation;
    boxWidth: number;
    boxHeight: number;
  };

  ocrEngine.recognize(imageDataUrl, { orientation, boxWidth, boxHeight })
    .then((result) => sendResponse({ type: "MANGA_OCR_RESULT", payload: result }))
    .catch((error) => sendResponse({
      type: "ERROR",
      payload: { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
    }));

  return true;
});
