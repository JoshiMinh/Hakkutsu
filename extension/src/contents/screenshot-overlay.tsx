import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import { X, Sparkles, Languages, Copy, Check, BookOpen, RefreshCw, Edit3, AlignLeft, AlignJustify, ArrowRight } from "lucide-react";
import type { TokenAnalysis } from "~lib/types";
import { useTranslation } from "~lib/languages/locales";
import cssText from "data-text:~style.css";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: ["*://*.saucenao.com/*", "*://saucenao.com/*"],
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + `
    #hk-screenshot-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
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
      background: rgba(0, 0, 0, 0.5);
    }
    .hk-screenshot-selection {
      position: absolute;
      border: 2px solid var(--hk-accent-primary, #a855f7);
      background: rgba(168, 85, 247, 0.15);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      clip-path: inset(-9999px);
    }
    .hk-modal-panel {
      position: absolute;
      background: #121214;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      color: #f4f4f5;
      font-family: var(--hk-font-sans, system-ui, sans-serif);
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
      z-index: 2147483647;
      width: 440px;
      max-width: calc(100vw - 32px);
      cursor: default;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .hk-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #18181b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hk-modal-tabs {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: #09090b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .hk-modal-tab-group {
      display: flex;
      gap: 4px;
    }
    .hk-modal-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: #a1a1aa;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .hk-modal-tab:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fafafa;
    }
    .hk-modal-tab--active {
      background: rgba(168, 85, 247, 0.18);
      color: #c084fc;
      font-weight: 600;
    }
    .hk-orientation-picker {
      display: flex;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    .hk-orient-btn {
      background: transparent;
      border: none;
      color: #71717a;
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .hk-orient-btn:hover {
      color: #fafafa;
    }
    .hk-orient-btn--active {
      background: #3f3f46;
      color: #c084fc;
      font-weight: 600;
    }
    .hk-modal-body {
      padding: 14px 16px;
      max-height: 460px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .hk-text-display {
      font-family: var(--hk-font-jp, "Noto Sans JP", sans-serif);
      font-size: 16px;
      line-height: 1.6;
      color: #fafafa;
      word-break: break-word;
      background: #18181b;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .hk-text-input {
      width: 100%;
      min-height: 80px;
      font-family: var(--hk-font-jp, "Noto Sans JP", sans-serif);
      font-size: 15px;
      line-height: 1.6;
      color: #fafafa;
      background: #18181b;
      border: 1px solid rgba(168, 85, 247, 0.4);
      border-radius: 8px;
      padding: 10px 12px;
      box-sizing: border-box;
      resize: vertical;
      outline: none;
    }
    .hk-token-span {
      cursor: pointer;
      padding: 1px 3px;
      margin: 0 1px;
      border-radius: 4px;
      transition: background 0.15s;
    }
    .hk-token-span:hover {
      background: rgba(168, 85, 247, 0.35);
      color: #f3e8ff;
    }
    .hk-translation-box {
      background: rgba(20, 184, 166, 0.1);
      border-left: 3px solid #14b8a6;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 14px;
      line-height: 1.5;
      color: #ccfbf1;
    }
    .hk-modal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #18181b;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      gap: 8px;
    }
    .hk-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .hk-btn--primary {
      background: #9333ea;
      color: #fff;
    }
    .hk-btn--primary:hover {
      background: #a855f7;
    }
    .hk-btn--secondary {
      background: #27272a;
      color: #e4e4e7;
      border-color: rgba(255, 255, 255, 0.1);
    }
    .hk-btn--secondary:hover {
      background: #3f3f46;
      color: #fff;
    }
    .hk-btn--ghost {
      background: transparent;
      color: #a1a1aa;
    }
    .hk-btn--ghost:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fafafa;
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
  const { t, isVietnamese } = useTranslation();
  const [isActive, setIsActive] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  
  // Results & Modes
  const [activeTab, setActiveTab] = useState<"ocr" | "translate">("ocr");
  const [orientation, setOrientation] = useState<"auto" | "horizontal" | "vertical">("auto");
  const [loading, setLoading] = useState(false);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [tokens, setTokens] = useState<TokenAnalysis[] | null>(null);
  const [translation, setTranslation] = useState<string>("");
  const [transLoading, setTransLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState<string>("");
  const [resultRect, setResultRect] = useState<Rect | null>(null);

  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === "START_SCREENSHOT_FLOW") {
        setIsActive(true);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleClose = useCallback(() => {
    setIsActive(false);
    setScreenshotUrl(null);
    setSelection(null);
    setResultRect(null);
    setOcrText("");
    setEditedText("");
    setIsEditing(false);
    setCroppedDataUrl(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isActive) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleClose]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || resultRect) return;
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
    setResultRect(selection);
    await processCrop(selection, orientation);
  };

  const processCrop = async (rect: Rect, targetOrientation: "auto" | "horizontal" | "vertical") => {
    if (!screenshotUrl) return;
    setLoading(true);
    setIsEditing(false);

    try {
      // 1. Crop canvas
      const img = new Image();
      img.src = screenshotUrl;
      await new Promise(r => img.onload = r);

      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
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

      const croppedUrl = canvas.toDataURL("image/png");
      setCroppedDataUrl(croppedUrl);

      // 2. Call OCR API via Background Script
      const data = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "OCR_IMAGE", payload: { image_data: croppedUrl, language: targetOrientation } },
          (res) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            if (res?.type === "ERROR") return reject(new Error(res.payload.error));
            resolve(res?.payload);
          }
        );
      });

      const fullText = data?.full_text || "";
      setOcrText(fullText);
      setEditedText(fullText);
      setTokens(data?.tokens || null);

      if (data?.translation) {
        setTranslation(data.translation);
      } else if (fullText) {
        try {
          const transData = await new Promise<any>((resolve, reject) => {
            chrome.runtime.sendMessage(
              { type: "TRANSLATE_TEXT", payload: { texts: [fullText] } },
              (res) => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                if (res?.type === "ERROR") return reject(new Error(res.payload.error));
                resolve(res?.payload);
              }
            );
          });
          setTranslation(transData?.translations?.[0] || "");
        } catch (tErr) {
          console.error("Translation error", tErr);
        }
      }
    } catch (err: any) {
      console.error("Crop processing error", err);
      setOcrText(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOrientationChange = async (newOrient: "auto" | "horizontal" | "vertical") => {
    setOrientation(newOrient);
    if (resultRect) {
      await processCrop(resultRect, newOrient);
    }
  };

  const handleReAnalyzeText = async () => {
    if (!editedText.trim()) return;
    setOcrText(editedText);
    setIsEditing(false);
    setTransLoading(true);

    try {
      // Re-tokenize and re-translate
      const [analRes, transRes] = await Promise.all([
        new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", payload: { text: editedText } }, resolve);
        }),
        new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", payload: { texts: [editedText] } }, resolve);
        })
      ]);

      if (analRes?.type === "ANALYZE_RESULT" && analRes.payload?.tokens) {
        setTokens(analRes.payload.tokens);
      }
      if (transRes?.type === "TRANSLATE_RESULT") {
        setTranslation(transRes.payload?.translations?.[0] || transRes.payload?.translation || "");
      }
    } catch (err) {
      console.error("Re-analyze error", err);
    } finally {
      setTransLoading(false);
    }
  };

  const handleCopy = () => {
    const textToCopy = activeTab === "translate" && translation ? translation : ocrText;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
  };

  if (!isActive) return null;

  return (
    <div 
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--hk-font-sans, system-ui, sans-serif)"
      }}
      onClick={handleClose}
    >
      <div 
        style={{
          width: "400px",
          maxWidth: "90vw",
          background: "#121214",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "14px",
          padding: "20px 24px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
          color: "#fafafa",
          textAlign: "center"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "rgba(168, 85, 247, 0.15)",
          color: "#c084fc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 14px",
          border: "1px solid rgba(168, 85, 247, 0.3)"
        }}>
          <Sparkles size={24} />
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: 700, color: "#ffffff" }}>
          Hakkutsu OCR — Coming Soon!
        </h3>

        <p style={{ margin: "0 0 20px", fontSize: "13.5px", color: "#a1a1aa", lineHeight: "1.5" }}>
          {t("ocr_coming_soon")}
        </p>

        <button 
          className="hk-btn hk-btn--primary"
          style={{
            padding: "8px 24px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "8px",
            cursor: "pointer",
            width: "100%",
            justifyContent: "center"
          }}
          onClick={handleClose}
        >
          {t("ocr_close")}
        </button>
      </div>
    </div>
  );
};

export default ScreenshotOverlay;
