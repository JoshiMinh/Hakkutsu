import { useState, useEffect, useCallback, useRef } from "react";
import { PageDifficultyPanel } from "./page-difficulty-panel";
import type { PageDensityAnalysis } from "~/features/analytics/types";
import type { SelectiveFuriganaMode } from "~/features/settings/types";
import { analyzePageDensity } from "~/features/analytics/page-analyzer";
import { injectSelectiveFurigana, removeSelectiveFurigana } from "~/features/analytics/furigana-injector";
import { useSettingsStore } from "~/features/settings/settings-store";
import { useTranslation } from "~/shared/locales";
import { densityMutationRelevant } from "./density-content";

export function ImmersionDensityBadge() {
  const { settings, updateSettings } = useSettingsStore();
  const { isVietnamese } = useTranslation();
  const [analysis, setAnalysis] = useState<PageDensityAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [furiganaLoading, setFuriganaLoading] = useState(false);
  const [furiganaMessage, setFuriganaMessage] = useState("");
  const [furiganaError, setFuriganaError] = useState(false);
  const generation = useRef(0);
  const analysisGeneration = useRef(0);
  const analysisController = useRef<AbortController>();
  const [analysisError, setAnalysisError] = useState(false);
  const tracked = useRef({ url: "", count: 0 });
  const [expanded, setExpanded] = useState(false);
  const [furiganaActive, setFuriganaActive] = useState(false);
  const [furiganaMode, setFuriganaMode] = useState<SelectiveFuriganaMode>(
    settings.selectiveFuriganaMode || "unlearned"
  );
  const [hidden, setHidden] = useState(false);

  const runAnalysis = useCallback(async () => {
    const id = ++analysisGeneration.current;
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      setLoading(true);
      setAnalysisError(false);
      const data = await analyzePageDensity(document.body, controller.signal);
      if (id !== analysisGeneration.current || data.url !== location.href) return;
      setAnalysis(data);

      // Track read characters to analytics if page has Japanese text
      if (tracked.current.url !== data.url) tracked.current = { url: data.url, count: 0 };
      const delta = Math.max(0, data.totalJapaneseChars - tracked.current.count);
      if (delta > 0 && window.top === window && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        tracked.current.count = data.totalJapaneseChars;
        chrome.runtime.sendMessage({
          type: "TRACK_CHARACTERS_READ",
          payload: { count: delta },
        }).catch(() => {});
      }
    } catch (err) {
      if (controller.signal.aborted || id !== analysisGeneration.current) return;
      setAnalysis(null);
      setAnalysisError(true);
      console.warn("[Hakkutsu] Page density analysis error:", err);
    } finally {
      if (id === analysisGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings.webpageDensityBadgeEnabled === false || document.contentType.startsWith("image/")) {
      setHidden(true);
      generation.current++;
      analysisGeneration.current++;
      analysisController.current?.abort();
      removeSelectiveFurigana();
      setFuriganaActive(false);
      setFuriganaLoading(false);
      return;
    }
    setHidden(false);

    // Run after initial page load settles
    let timer = setTimeout(runAnalysis, 800);
    const schedule = () => {
      analysisGeneration.current++;
      analysisController.current?.abort();
      clearTimeout(timer);
      timer = setTimeout(runAnalysis, 400);
    };
    const observer = new MutationObserver(records => {
      if (records.some(densityMutationRelevant)) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "style", "class"] });
    let url = location.href;
    const navigation = setInterval(() => {
      if (url !== location.href) { url = location.href; setAnalysis(null); schedule(); }
    }, 500);
    const storageChanged = (_changes: unknown, area: string) => { if (area === "local") schedule(); };
    chrome.storage?.onChanged?.addListener(storageChanged);
    return () => {
      clearTimeout(timer); clearInterval(navigation); observer.disconnect();
      chrome.storage?.onChanged?.removeListener(storageChanged);
      analysisGeneration.current++; analysisController.current?.abort();
    };
  }, [runAnalysis, settings.webpageDensityBadgeEnabled]);

  useEffect(() => () => {
    generation.current++;
    analysisGeneration.current++;
    analysisController.current?.abort();
    removeSelectiveFurigana();
  }, []);

  useEffect(() => {
    if (!furiganaActive && !furiganaLoading) setFuriganaMode(settings.selectiveFuriganaMode || "unlearned");
  }, [settings.selectiveFuriganaMode, furiganaActive, furiganaLoading]);

  const applyFurigana = async (mode: SelectiveFuriganaMode) => {
    const id = ++generation.current;
    setFuriganaLoading(true);
    setFuriganaMessage("");
    setFuriganaError(false);
    const fail = (error: Error) => {
      if (id !== generation.current) return;
      setFuriganaActive(false);
      setFuriganaError(true);
      setFuriganaMessage(error.message);
    };
    try {
      const result = await injectSelectiveFurigana(mode, document.body, fail);
      if (id !== generation.current || result.cancelled) return;
      setFuriganaActive(true);
      if (!result.injectedRubies) setFuriganaMessage(isVietnamese ? "Không có từ phù hợp với chế độ này." : "No matching readings for this mode.");
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (id === generation.current) setFuriganaLoading(false);
    }
  };

  const handleToggleFurigana = () => {
    if (furiganaActive || furiganaLoading) {
      generation.current++;
      removeSelectiveFurigana();
      setFuriganaActive(false);
      setFuriganaLoading(false);
      setFuriganaMessage("");
    } else {
      void applyFurigana(furiganaMode);
    }
  };

  const handleModeChange = async (newMode: SelectiveFuriganaMode) => {
    setFuriganaMode(newMode);
    updateSettings({ selectiveFuriganaMode: newMode });
    if (furiganaActive || furiganaLoading) void applyFurigana(newMode);
  };

  if (!hidden && analysisError) return <div className="hk-density-badge hk-difficulty"><button type="button" className="hk-difficulty__trigger" onClick={runAnalysis} disabled={loading} role="status">{isVietnamese ? "Không thể phân tích trang · Thử lại" : "Page analysis unavailable · Retry"}</button></div>;
  if (hidden || !analysis || analysis.totalJapaneseChars === 0) {
    return null;
  }

  return <PageDifficultyPanel analysis={analysis} vietnamese={isVietnamese} expanded={expanded}
    onExpandedChange={setExpanded} loading={loading} furiganaLoading={furiganaLoading}
    furiganaActive={furiganaActive} furiganaMode={furiganaMode} furiganaMessage={furiganaMessage}
    furiganaError={furiganaError} onToggleFurigana={handleToggleFurigana}
    onModeChange={handleModeChange} onRescan={runAnalysis} />;
}
