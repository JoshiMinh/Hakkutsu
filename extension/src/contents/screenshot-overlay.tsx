import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiClient } from "~services/api-client";
import type { OcrRegion, AnalyzeResponse, TokenAnalysis } from "~types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = `
    #hk-screenshot-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647; /* Max z-index */
      cursor: crosshair;
      user-select: none;
    }
    .hk-screenshot-bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-size: 100vw 100vh;
      background-repeat: no-repeat;
    }
    .hk-screenshot-dim {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
    }
    .hk-screenshot-selection {
      position: absolute;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.2);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
      clip-path: inset(-9999px);
    }
    .hk-ocr-result {
      position: absolute;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      color: #f8fafc;
      font-family: sans-serif;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      z-index: 10;
      max-width: 400px;
      cursor: default;
    }
    .hk-ocr-result-close {
      position: absolute;
      top: 4px;
      right: 8px;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 16px;
    }
    .hk-ocr-result-close:hover {
      color: white;
    }
    .hk-ocr-text {
      margin-top: 8px;
      font-size: 18px;
      line-height: 1.5;
    }
    .hk-ocr-token {
      cursor: pointer;
      display: inline-block;
    }
    .hk-ocr-token:hover {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
    .hk-ocr-loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(15, 23, 42, 0.9);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 16px;
    }
  `;
  return style;
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ScreenshotOverlay = () => {
  const [isActive, setIsActive] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [ocrResult, setOcrResult] = useState<{ text: string; rect: Rect; tokens: TokenAnalysis[] | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === "START_SCREENSHOT_FLOW") {
        setOcrResult(null);
        setSelection(null);
        setScreenshotUrl(null);
        
        // Request background to take screenshot
        chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }, (res) => {
          if (res?.type === "SCREENSHOT_RESULT") {
            setScreenshotUrl(res.payload.dataUrl);
            setIsActive(true);
          } else {
            console.error("Screenshot failed", res);
          }
        });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && isActive) {
      setIsActive(false);
      setScreenshotUrl(null);
      setSelection(null);
      setOcrResult(null);
    }
  }, [isActive]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || ocrResult) return;
    setIsDragging(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !startPos) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    setSelection({
      x: Math.min(startPos.x, currentX),
      y: Math.min(startPos.y, currentY),
      width: Math.abs(currentX - startPos.x),
      height: Math.abs(currentY - startPos.y)
    });
  };

  const handleMouseUp = async () => {
    if (!isDragging || !selection || selection.width < 10 || selection.height < 10) {
      setIsDragging(false);
      setSelection(null);
      return;
    }
    setIsDragging(false);
    await processSelection(selection);
  };

  const processSelection = async (rect: Rect) => {
    if (!screenshotUrl) return;
    setLoading(true);

    try {
      // 1. Crop image using canvas
      const img = new Image();
      img.src = screenshotUrl;
      await new Promise(r => img.onload = r);

      const canvas = document.createElement("canvas");
      // Handle device pixel ratio for correct cropping
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        img, 
        rect.x * dpr, 
        rect.y * dpr, 
        rect.width * dpr, 
        rect.height * dpr, 
        0, 
        0, 
        rect.width * dpr, 
        rect.height * dpr
      );

      const croppedDataUrl = canvas.toDataURL("image/png");

      // 2. Send to OCR API
      // Use standard fetch directly if apiClient doesn't have an ocr method yet
      const settingsResult = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => resolve(res.payload));
      });
      const baseUrl = settingsResult.backendUrl || "http://localhost:8000";
      
      const res = await fetch(`${baseUrl}/api/v1/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_data: croppedDataUrl,
          language: "jpn"
        })
      });
      
      if (!res.ok) throw new Error("OCR failed");
      const data = await res.json();
      
      if (data.full_text) {
        // 3. Analyze text for tokens
        const analyzeMsg = await new Promise<any>(resolve => {
          chrome.runtime.sendMessage({ 
            type: "ANALYZE_TEXT", 
            payload: { text: data.full_text, include_definitions: false } 
          }, resolve);
        });

        let tokens = null;
        if (analyzeMsg?.type === "ANALYZE_RESULT") {
          tokens = analyzeMsg.payload.tokens;
        }

        setOcrResult({ text: data.full_text, rect, tokens });
      } else {
        setIsActive(false); // No text found
      }
    } catch (err) {
      console.error(err);
      setIsActive(false);
    } finally {
      setLoading(false);
    }
  };

  const handleTokenClick = (token: TokenAnalysis, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token.is_japanese) return;

    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.dictionary_form || token.surface,
          x: e.clientX,
          y: e.clientY,
        },
      })
    );

    chrome.runtime.sendMessage({
      type: "TEXT_SELECTED",
      payload: {
        text: token.dictionary_form || token.surface,
        context: ocrResult?.text,
        x: e.clientX,
        y: e.clientY,
        sourceUrl: window.location.href,
      },
    }).catch(() => {});
  };

  if (!isActive) return null;

  return (
    <div 
      id="hk-screenshot-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {screenshotUrl && (
        <>
          <div className="hk-screenshot-bg" style={{ backgroundImage: `url(${screenshotUrl})` }} />
          {!selection && !ocrResult && <div className="hk-screenshot-dim" />}
        </>
      )}

      {selection && !ocrResult && (
        <div 
          className="hk-screenshot-selection"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height
          }}
        />
      )}

      {loading && (
        <div className="hk-ocr-loading">Scanning text...</div>
      )}

      {ocrResult && (
        <div 
          className="hk-ocr-result"
          style={{
            left: ocrResult.rect.x + ocrResult.rect.width + 10 > window.innerWidth - 400 
                  ? ocrResult.rect.x - 410 
                  : ocrResult.rect.x + ocrResult.rect.width + 10,
            top: ocrResult.rect.y
          }}
          onMouseDown={(e) => e.stopPropagation()} // Prevent closing/dragging when clicking result
        >
          <button 
            className="hk-ocr-result-close"
            onClick={() => setIsActive(false)}
          >
            ✕
          </button>
          <div className="hk-ocr-text">
            {ocrResult.tokens ? (
              ocrResult.tokens.map((token, i) => (
                <span 
                  key={i} 
                  className="hk-ocr-token"
                  onClick={(e) => handleTokenClick(token, e)}
                >
                  {token.surface}
                </span>
              ))
            ) : (
              ocrResult.text
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenshotOverlay;
