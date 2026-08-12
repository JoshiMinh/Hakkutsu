import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import { X, Sparkles, Paintbrush, Languages, Copy, Check, Download, Layers, BookOpen, RefreshCw } from "lucide-react";
import { apiClient } from "~services/api-client";
import type { TokenAnalysis } from "~types";
import cssText from "data-text:~style.css";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
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
      border: 2px solid var(--hk-accent-primary);
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
      width: 420px;
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
      gap: 4px;
      padding: 6px 12px;
      background: #09090b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .hk-modal-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
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
    .hk-token-span {
      cursor: pointer;
      padding: 1px 2px;
      border-radius: 4px;
      transition: background 0.15s;
    }
    .hk-token-span:hover {
      background: rgba(168, 85, 247, 0.3);
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
    .hk-inpaint-preview-wrapper {
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #09090b;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .hk-inpaint-preview-img {
      width: 100%;
      height: auto;
      max-height: 260px;
      object-fit: contain;
      display: block;
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
  const [isActive, setIsActive] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  
  // Results & Modes
  const [activeTab, setActiveTab] = useState<"ocr" | "translate">("ocr");
  const [loading, setLoading] = useState(false);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [tokens, setTokens] = useState<TokenAnalysis[] | null>(null);
  const [translation, setTranslation] = useState<string>("");
  const [transLoading, setTransLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resultRect, setResultRect] = useState<Rect | null>(null);

  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === "START_SCREENSHOT_FLOW") {
        setOcrText("");
        setTokens(null);
        setTranslation("");
        setTransLoading(false);
        setSelection(null);
        setResultRect(null);
        setCroppedDataUrl(null);
        setActiveTab("ocr");
        
        chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }, (res) => {
          if (res?.type === "SCREENSHOT_RESULT") {
            setScreenshotUrl(res.payload.dataUrl);
            setIsActive(true);
          }
        });
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
    await processCrop(selection);
  };

  const processCrop = async (rect: Rect) => {
    if (!screenshotUrl) return;
    setLoading(true);

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
            { type: "OCR_IMAGE", payload: { image_data: croppedUrl, language: "jpn" } },
            (res) => {
              if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
              if (res?.type === "ERROR") return reject(new Error(res.payload.error));
              resolve(res?.payload);
            }
          );
        });

        const fullText = data?.full_text || "";
        setOcrText(fullText);
        setTokens(data?.tokens || null);

        // Also fetch translation
        if (fullText) {
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
    } catch (err) {
      console.error("Crop processing error", err);
    } finally {
      setLoading(false);
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
      id="hk-screenshot-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {screenshotUrl && (
        <>
          <div className="hk-screenshot-bg" style={{ backgroundImage: `url(${screenshotUrl})` }} />
          {!selection && !resultRect && <div className="hk-screenshot-dim" />}
        </>
      )}

      {selection && !resultRect && (
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

      {/* Floating Action / Result Panel */}
      {resultRect && (
        <div 
          className="hk-modal-panel"
          style={{
            left: Math.max(16, Math.min(window.innerWidth - 440, resultRect.x + resultRect.width + 12 > window.innerWidth - 440 ? resultRect.x - 430 : resultRect.x + resultRect.width + 12)),
            top: Math.max(16, Math.min(window.innerHeight - 480, resultRect.y))
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="hk-modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "13px" }}>
              <Sparkles size={16} style={{ color: "#a855f7" }} />
              <span>Hakkutsu AI Tool</span>
            </div>
            <button className="hk-btn hk-btn--ghost" style={{ padding: "4px" }} onClick={handleClose}>
              <X size={16} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="hk-modal-tabs">
            <button 
              className={`hk-modal-tab ${activeTab === "ocr" ? "hk-modal-tab--active" : ""}`}
              onClick={() => setActiveTab("ocr")}
            >
              <BookOpen size={14} /> Nhận diện (OCR)
            </button>
            <button 
              className={`hk-modal-tab ${activeTab === "translate" ? "hk-modal-tab--active" : ""}`}
              onClick={() => setActiveTab("translate")}
            >
              <Languages size={14} /> Dịch nghĩa
            </button>
          </div>

          {/* Tab Content */}
          <div className="hk-modal-body">
            {loading ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#a1a1aa" }}>
                <RefreshCw size={24} className="hk-spin" style={{ color: "#a855f7", margin: "0 auto 10px" }} />
                <div style={{ fontSize: "13px" }}>Đang quét chữ trong ảnh (AI Vision)...</div>
              </div>
            ) : (
              <>
                {/* TAB 1: OCR */}
                {activeTab === "ocr" && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Văn bản gốc
                    </div>
                    <div className="hk-text-display">
                      {tokens && tokens.length > 0 ? (
                        tokens.map((token, idx) => (
                          <span 
                            key={idx} 
                            className="hk-token-span"
                            onClick={(e) => handleTokenClick(token, e)}
                            title={typeof token.reading === "string" ? token.reading : (token.reading?.hiragana || token.surface)}
                          >
                            {token.surface}
                          </span>
                        ))
                      ) : (
                        ocrText || <span style={{ color: "#71717a" }}>Không tìm thấy chữ trong vùng chọn</span>
                      )}
                    </div>

                    {transLoading ? (
                      <div className="hk-translation-box" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <RefreshCw size={14} className="hk-spin" />
                        <span>Đang tạo bản dịch Gemini...</span>
                      </div>
                    ) : translation ? (
                      <div className="hk-translation-box">
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "#14b8a6", marginBottom: "4px" }}>BẢN DỊCH TIẾNG VIỆT</div>
                        {translation}
                      </div>
                    ) : null}
                  </>
                )}


                {/* TAB 3: TRANSLATE */}
                {activeTab === "translate" && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase" }}>
                      Bản dịch tiếng Việt
                    </div>
                    <div className="hk-translation-box" style={{ fontSize: "15px" }}>
                      {transLoading ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#14b8a6" }}>
                          <RefreshCw size={15} className="hk-spin" />
                          <span>Đang tạo bản dịch...</span>
                        </div>
                      ) : (
                        translation || <span style={{ color: "#71717a" }}>Chưa có bản dịch cho câu này.</span>
                      )}
                    </div>

                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase", marginTop: "8px" }}>
                      Câu gốc
                    </div>
                    <div className="hk-text-display" style={{ fontSize: "14px" }}>
                      {ocrText || "—"}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="hk-modal-footer">
            <div style={{ display: "flex", gap: "6px" }}>
              <button className="hk-btn hk-btn--secondary" onClick={handleCopy} disabled={!ocrText}>
                {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                {copied ? "Đã chép" : "Sao chép"}
              </button>
              <button className="hk-btn hk-btn--ghost" onClick={handleClose}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenshotOverlay;
