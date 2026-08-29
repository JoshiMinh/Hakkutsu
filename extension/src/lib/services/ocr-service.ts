import { createWorker } from "tesseract.js";

class LocalOcrService {
  private workers: Map<string, any> = new Map();

  private resolveLang(language?: string): string {
    if (!language || language === "auto") return "jpn+jpn_vert";
    if (language === "horizontal" || language === "jpn") return "jpn";
    if (language === "vertical" || language === "jpn_vert") return "jpn_vert";
    return language;
  }

  private async loadWorker(language: string = "jpn") {
    const langKey = this.resolveLang(language);
    if (!this.workers.has(langKey)) {
      const workerPath = typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("assets/tesseract/worker.min.js")
        : undefined;
      const corePath = typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("assets/tesseract/core/")
        : undefined;
      const langPath = typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("assets/tesseract/tessdata/")
        : undefined;

      const worker = await createWorker(langKey, 1, {
        workerPath,
        corePath,
        langPath,
        workerBlobURL: false,
      });
      this.workers.set(langKey, worker);
    }
    return this.workers.get(langKey);
  }

  async recognizeImage(dataUrl: string, language: string = "auto"): Promise<string> {
    try {
      // 1. If running inside Service Worker with offscreen document API available
      if (typeof chrome !== "undefined" && chrome.offscreen?.createDocument) {
        return await this.recognizeViaOffscreen(dataUrl, language);
      }

      // 2. Direct Tesseract worker (content script or DOM window context)
      const worker = await this.loadWorker(language);
      const { data } = await worker.recognize(dataUrl);
      return (data.text || "").trim();
    } catch (e: any) {
      console.error("[OcrService] Error:", e);
      throw new Error(e?.message || String(e));
    }
  }

  private async recognizeViaOffscreen(dataUrl: string, language: string): Promise<string> {
    const offscreenUrl = chrome.runtime.getURL("tabs/offscreen.html");
    
    // Check if offscreen document exists
    if (typeof (chrome.runtime as any).getContexts === "function") {
      const existingContexts = await (chrome.runtime as any).getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      });
      if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
          url: "tabs/offscreen.html",
          reasons: ["BLOBS" as any],
          justification: "Run Tesseract.js OCR in offscreen DOM environment for local Japanese text recognition",
        });
      }
    } else {
      try {
        await chrome.offscreen.createDocument({
          url: "tabs/offscreen.html",
          reasons: ["BLOBS" as any],
          justification: "Run Tesseract.js OCR in offscreen DOM environment for local Japanese text recognition",
        });
      } catch (err: any) {
        // Document might already exist
        if (!err.message?.includes("Only a single offscreen document may be created")) {
          throw err;
        }
      }
    }

    // Ping offscreen document to ensure listener is active
    let isReady = false;
    for (let i = 0; i < 15; i++) {
      try {
        const pong = await new Promise<any>((res) => {
          chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" }, (response) => {
            if (chrome.runtime.lastError) res(null);
            else res(response);
          });
        });
        if (pong?.type === "OFFSCREEN_PONG") {
          isReady = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }

    if (!isReady) {
      console.warn("[OcrService] Offscreen page didn't respond to ping within 2.25s, trying anyway...");
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "RUN_OFFSCREEN_OCR", payload: { dataUrl, language } },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (response?.type === "OFFSCREEN_OCR_ERROR") {
            return reject(new Error(response.payload?.error || "Offscreen OCR error"));
          }
          resolve(response?.payload?.text || "");
        }
      );
    });
  }
}

export const localOcrService = new LocalOcrService();

