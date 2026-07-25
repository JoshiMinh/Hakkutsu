import type { PlasmoCSConfig } from "plasmo";
import { useState, useEffect } from "react";
import { containsJapanese } from "~lib/japanese";

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
      rootContainer.id = "hakkutsu-mining";
      document.body.appendChild(rootContainer);
      clearInterval(checkInterval);
      resolve(rootContainer);
    }, 137);
  });
};

const SentenceMining = () => {
  const [isActive, setIsActive] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<HTMLElement | null>(null);
  const [minedStatus, setMinedStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      if (hoveredNode) {
        hoveredNode.style.outline = "";
        hoveredNode.style.backgroundColor = "";
        setHoveredNode(null);
      }
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.id && target.id.startsWith("hakkutsu")) return;
      
      const text = target.textContent || "";
      if (containsJapanese(text)) {
        target.style.outline = "2px dashed var(--hk-accent-crimson, #e85d75)";
        target.style.backgroundColor = "rgba(232, 93, 117, 0.1)";
        target.style.cursor = "pointer";
        setHoveredNode(target);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target === hoveredNode) {
        target.style.outline = "";
        target.style.backgroundColor = "";
        target.style.cursor = "";
        setHoveredNode(null);
      }
    };

    const handleClick = async (e: MouseEvent) => {
      if (hoveredNode && e.target === hoveredNode) {
        e.preventDefault();
        e.stopPropagation();
        
        const text = hoveredNode.textContent || "";
        setMinedStatus("Mining...");
        
        try {
          await chrome.runtime.sendMessage({
            type: "MINE_SENTENCE",
            payload: {
              user_id: "user_1",
              sentence: text,
              source_url: window.location.href,
              source_title: document.title,
            }
          });
          setMinedStatus("✓ Saved!");
          setTimeout(() => setMinedStatus(null), 2000);
          
          // Flash green
          hoveredNode.style.outline = "2px solid #10b981";
          hoveredNode.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
          setTimeout(() => {
            if (isActive) {
              hoveredNode.style.outline = "2px dashed var(--hk-accent-crimson, #e85d75)";
              hoveredNode.style.backgroundColor = "rgba(232, 93, 117, 0.1)";
            }
          }, 1000);
        } catch (err) {
          console.error("Mining failed", err);
          setMinedStatus("✗ Failed");
          setTimeout(() => setMinedStatus(null), 2000);
        }
      }
    };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("click", handleClick, true); // Use capture phase

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isActive, hoveredNode]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "20px", // Opposite side of heatmap
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
      <div style={{ fontSize: 14, fontWeight: "bold" }}>⛏️ Sentence Mining</div>
      <button 
        className={`hk-btn ${isActive ? 'hk-btn--secondary' : 'hk-btn--primary'} hk-btn--sm`}
        onClick={() => setIsActive(!isActive)}
      >
        {isActive ? "🛑 Stop" : "▶️ Start"}
      </button>
      {minedStatus && (
        <span style={{ fontSize: 12, color: minedStatus.includes("✓") ? "#10b981" : minedStatus.includes("✗") ? "#ef4444" : "var(--hk-text-muted)" }}>
          {minedStatus}
        </span>
      )}
    </div>
  );
};

export default SentenceMining;
