import {
  ocrEngine,
  type OcrOrientation,
  type OcrCropItem,
} from "~/features/ocr/ocr-engine";

export function registerOcrOffscreen() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_MANGA_OCR_OFFSCREEN") {
      const { imageDataUrl, orientation, boxWidth, boxHeight } =
        message.payload as {
          imageDataUrl: string;
          orientation: OcrOrientation;
          boxWidth: number;
          boxHeight: number;
        };

      ocrEngine
        .recognize(imageDataUrl, { orientation, boxWidth, boxHeight })
        .then((result) =>
          sendResponse({ type: "MANGA_OCR_RESULT", payload: result }),
        )
        .catch((error) =>
          sendResponse({
            type: "ERROR",
            payload: {
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
            },
          }),
        );
      return true;
    }

    if (message?.type === "RUN_MANGA_OCR_BATCH_OFFSCREEN") {
      const { crops } = message.payload as { crops: OcrCropItem[] };
      ocrEngine
        .recognizeBatch(crops)
        .then((results) =>
          sendResponse({ type: "MANGA_OCR_BATCH_RESULT", payload: results }),
        )
        .catch((error) =>
          sendResponse({
            type: "ERROR",
            payload: {
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
            },
          }),
        );
      return true;
    }
  });
}
