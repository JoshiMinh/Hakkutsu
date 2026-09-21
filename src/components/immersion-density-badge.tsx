import { useState, useEffect, useCallback } from "react";
import { Sparkles, ChevronUp, ChevronDown, RefreshCw, Eye, EyeOff, Layers, X } from "lucide-react";
import type { PageDensityAnalysis, SelectiveFuriganaMode } from "~lib/utils/types";
import { analyzePageDensity } from "~lib/services/page-analyzer";
import { injectSelectiveFurigana, removeSelectiveFurigana } from "~lib/services/furigana-injector";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";

export function ImmersionDensityBadge() {
  const { settings, updateSettings } = useSettingsStore();
  const { isVietnamese } = useTranslation();
  const [analysis, setAnalysis] = useState<PageDensityAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [furiganaActive, setFuriganaActive] = useState(false);
  const [furiganaMode, setFuriganaMode] = useState<SelectiveFuriganaMode>(
    settings.selectiveFuriganaMode || "unlearned"
  );
  const [hidden, setHidden] = useState(false);

  const runAnalysis = useCallback(async () => {
    try {
      setLoading(true);
      const data = await analyzePageDensity();
      setAnalysis(data);

      // Track read characters to analytics if page has Japanese text
      if (data.totalJapaneseChars > 0 && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "TRACK_CHARACTERS_READ",
          payload: { count: data.totalJapaneseChars },
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[Hakkutsu] Page density analysis error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings.webpageDensityBadgeEnabled === false) {
      setHidden(true);
      return;
    }

    // Run after initial page load settles
    const timer = setTimeout(() => {
      runAnalysis();
    }, 800);

    return () => clearTimeout(timer);
  }, [runAnalysis, settings.webpageDensityBadgeEnabled]);

  const handleToggleFurigana = async () => {
    if (furiganaActive) {
      removeSelectiveFurigana();
      setFuriganaActive(false);
    } else {
      setLoading(true);
      await injectSelectiveFurigana(furiganaMode);
      setFuriganaActive(true);
      setLoading(false);
    }
  };

  const handleModeChange = async (newMode: SelectiveFuriganaMode) => {
    setFuriganaMode(newMode);
    updateSettings({ selectiveFuriganaMode: newMode });
    if (furiganaActive) {
      setLoading(true);
      await injectSelectiveFurigana(newMode);
      setLoading(false);
    }
  };

  if (hidden || !analysis || analysis.totalJapaneseChars === 0) {
    return null;
  }

  const { percentages, dominantLevel, totalKanji, unlearnedCount } = analysis;

  const getJlptColor = (lvl: string) => {
    switch (lvl) {
      case "N5": return "#10b981";
      case "N4": return "#06b6d4";
      case "N3": return "#3b82f6";
      case "N2": return "#f59e0b";
      case "N1": return "#ef4444";
      default: return "#a855f7";
    }
  };

  return (
    <div
      className="hk-density-badge hk-fade-in"
      style={{
        position: "fixed",
        bottom: "20px",
        left: "20px",
        zIndex: 2147483640,
        pointerEvents: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Expanded Popover Panel */}
      {expanded && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            width: "300px",
            background: "#141418",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "12px",
            padding: "14px 16px",
            boxShadow: "0 16px 36px rgba(0, 0, 0, 0.7)",
            color: "#f4f4f5",
            fontSize: "12px",
          }}
          className="hk-fade-in"
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "13px" }}>
              <Layers size={14} style={{ color: "var(--hk-accent-primary, #a855f7)" }} />
              <span>{isVietnamese ? "Độ Khó Tiếng Nhật Trang Này" : "Page Japanese Breakdown"}</span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              style={{ background: "transparent", border: "none", color: "var(--hk-text-muted)", cursor: "pointer", padding: "2px" }}
            >
              <X size={14} />
            </button>
          </div>

          {/* JLPT Progress Distribution Bar */}
          <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", background: "rgba(255,255,255,0.06)", marginBottom: "10px" }}>
            {(["N5", "N4", "N3", "N2", "N1"] as const).map((lvl) => {
              const p = percentages[lvl] || 0;
              if (p <= 0) return null;
              return (
                <div
                  key={lvl}
                  title={`${lvl}: ${p}%`}
                  style={{
                    width: `${p}%`,
                    height: "100%",
                    backgroundColor: getJlptColor(lvl),
                  }}
                />
              );
            })}
          </div>

          {/* Level percentages pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
            {(["N5", "N4", "N3", "N2", "N1"] as const).map((lvl) => {
              const p = percentages[lvl] || 0;
              if (p <= 0) return null;
              return (
                <span
                  key={lvl}
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor: `rgba(255, 255, 255, 0.05)`,
                    color: getJlptColor(lvl),
                    border: `1px solid ${getJlptColor(lvl)}40`,
                  }}
                >
                  {lvl}: {p}%
                </span>
              );
            })}
          </div>

          {/* Summary Details */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--hk-text-muted)", marginBottom: "14px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span>{isVietnamese ? "Tổng Kanji" : "Total Kanji"}: <b style={{ color: "#fff" }}>{totalKanji}</b></span>
            <span>{isVietnamese ? "Chưa học" : "Unlearned"}: <b style={{ color: "#f87171" }}>{unlearnedCount}</b></span>
            <span>{isVietnamese ? "Cấp độ chính" : "Dominant"}: <b style={{ color: getJlptColor(dominantLevel) }}>{dominantLevel}</b></span>
          </div>

          {/* Selective Furigana Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, fontSize: "11.5px" }}>
                {isVietnamese ? "Furigana chọn lọc" : "Selective Furigana"}
              </span>
              <button
                onClick={handleToggleFurigana}
                style={{
                  background: furiganaActive ? "var(--hk-accent-primary, #a855f7)" : "rgba(255,255,255,0.1)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {furiganaActive ? <Eye size={12} /> : <EyeOff size={12} />}
                {furiganaActive ? (isVietnamese ? "Bật" : "Active") : (isVietnamese ? "Tắt" : "Inactive")}
              </button>
            </div>

            {/* Mode Select */}
            <select
              value={furiganaMode}
              onChange={(e) => handleModeChange(e.target.value as SelectiveFuriganaMode)}
              style={{
                width: "100%",
                background: "#1e1e24",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "6px",
                color: "#ffffff",
                padding: "5px 8px",
                fontSize: "11px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="unlearned">{isVietnamese ? "Chỉ từ/kanji chưa học trong SRS" : "Only Unlearned Kanji/Words"}</option>
              <option value="n3_plus">{isVietnamese ? "Cấp độ N3 trở lên (N3, N2, N1)" : "Level N3 and Above (N3, N2, N1)"}</option>
              <option value="n2_plus">{isVietnamese ? "Cấp độ N2 trở lên (N2, N1)" : "Level N2 and Above (N2, N1)"}</option>
              <option value="n1_only">{isVietnamese ? "Chỉ cấp độ N1 & khó" : "Level N1 & Rare Kanji Only"}</option>
              <option value="all">{isVietnamese ? "Tất cả các chữ Hán (All Kanji)" : "All Kanji Characters"}</option>
            </select>
          </div>

          {/* Rescan Button */}
          <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={runAnalysis}
              disabled={loading}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--hk-text-muted)",
                fontSize: "11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <RefreshCw size={11} className={loading ? "hk-spin" : ""} />
              {isVietnamese ? "Quét lại trang" : "Rescan Page"}
            </button>
          </div>
        </div>
      )}

      {/* Floating Collapsible Pill */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "rgba(18, 18, 24, 0.92)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "20px",
          padding: "6px 12px",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(8px)",
          userSelect: "none",
          transition: "all 0.15s ease",
        }}
      >
        <span style={{ fontSize: "13px" }}>🌸</span>
        <span style={{ color: getJlptColor(dominantLevel), fontWeight: 700 }}>
          {percentages[dominantLevel as keyof typeof percentages] || 0}% {dominantLevel}
        </span>
        {totalKanji > 0 && (
          <span style={{ color: "var(--hk-text-muted)", fontSize: "11px", fontWeight: 400 }}>
            ({totalKanji} kanji)
          </span>
        )}
        {furiganaActive && (
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--hk-accent-primary, #a855f7)",
              boxShadow: "0 0 4px var(--hk-accent-primary, #a855f7)",
            }}
          />
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </div>
    </div>
  );
}
