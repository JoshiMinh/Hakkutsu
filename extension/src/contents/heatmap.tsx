import type { PlasmoCSConfig } from "plasmo";
import { useState } from "react";
import { containsJapanese } from "~lib/japanese";
import type { AnalyzeResponse } from "~types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
};

import cssText from "data-text:~style.css";

export const getStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText;
  return style;
};

export const getRootContainer = () => {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const rootContainer = document.createElement("div");
      rootContainer.id = "hakkutsu-heatmap";
      document.body.appendChild(rootContainer);
      clearInterval(checkInterval);
      resolve(rootContainer);
    }, 137);
  });
};

function getTextNodes(node: Node): Node[] {
  const textNodes: Node[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || "").trim();
    if (text.length > 0 && containsJapanese(text)) {
      textNodes.push(node);
    }
  } else {
    // Skip script, style, and our own containers
    if (["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(node.nodeName)) return textNodes;
    if (node instanceof Element && node.id && node.id.startsWith("hakkutsu")) return textNodes;
    
    for (const child of Array.from(node.childNodes)) {
      textNodes.push(...getTextNodes(child));
    }
  }
  return textNodes;
}

const Heatmap = () => {
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyHeatmap = async () => {
    if (isActive) {
      // For a real app, you'd want to store original nodes and revert them.
      // For this demo, we'll just reload the page or require a reload to undo.
      window.location.reload();
      return;
    }

    setLoading(true);
    setError(null);
    setIsActive(true);

    try {
      const textNodes = getTextNodes(document.body);
      
      // We shouldn't send the entire page at once, it might be huge.
      // Let's just do a limited number of nodes for this proof of concept.
      const nodesToProcess = textNodes.slice(0, 50);

      for (const node of nodesToProcess) {
        const text = node.textContent || "";
        
        try {
          // In a real app we need to pass user_id down from popup settings
          const response = await chrome.runtime.sendMessage({
            type: "ANALYZE_TEXT",
            payload: { text, include_definitions: false, user_id: "user_1" },
          });

          if (response?.type === "ANALYZE_RESULT") {
            const data = response.payload as AnalyzeResponse;
            const fragment = document.createDocumentFragment();
            
            data.tokens.forEach(token => {
              if (token.is_japanese && token.srs_state) {
                const span = document.createElement("span");
                span.textContent = token.surface;
                
                // Color code based on state
                switch (token.srs_state) {
                  case "new":
                    span.style.borderBottom = "2px solid #ef4444"; // Red
                    span.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
                    break;
                  case "learning":
                    span.style.borderBottom = "2px solid #f59e0b"; // Orange
                    span.style.backgroundColor = "rgba(245, 158, 11, 0.1)";
                    break;
                  case "review":
                    span.style.borderBottom = "2px solid #3b82f6"; // Blue
                    span.style.backgroundColor = "rgba(59, 130, 246, 0.1)";
                    break;
                  case "graduated":
                    span.style.borderBottom = "2px solid #10b981"; // Green
                    span.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
                    break;
                }
                fragment.appendChild(span);
              } else {
                fragment.appendChild(document.createTextNode(token.surface));
              }
            });
            
            if (node.parentNode) {
              node.parentNode.replaceChild(fragment, node);
            }
          }
        } catch (e) {
          console.warn("Failed to analyze a text node", e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Heatmap failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 2147483647,
        background: "var(--hk-bg, #1a1a2e)",
        color: "var(--hk-text, #f3f4f6)",
        borderRadius: "24px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        border: "1px solid var(--hk-border, #2a2a40)",
        padding: "8px 16px",
        fontFamily: "var(--hk-font-jp, sans-serif)",
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: "bold" }}>Hakkutsu Heatmap</div>
      <button 
        className={`hk-btn ${isActive ? 'hk-btn--secondary' : 'hk-btn--primary'} hk-btn--sm`}
        onClick={applyHeatmap}
        disabled={loading}
      >
        {loading ? "⏳ Processing..." : isActive ? "🛑 Disable" : "🔥 Enable"}
      </button>
      {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
    </div>
  );
};

export default Heatmap;
