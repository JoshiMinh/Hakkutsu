import { useEffect, useId, useRef } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers, Loader2, RefreshCw, X } from "lucide-react";
import type { PageDensityAnalysis } from "./types";
import type { SelectiveFuriganaMode } from "~/features/settings/types";

interface PageDifficultyPanelProps {
  analysis: PageDensityAnalysis;
  vietnamese: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  loading: boolean;
  furiganaLoading: boolean;
  furiganaActive: boolean;
  furiganaMode: SelectiveFuriganaMode;
  furiganaMessage: string;
  furiganaError: boolean;
  onToggleFurigana: () => void;
  onModeChange: (mode: SelectiveFuriganaMode) => void;
  onRescan: () => void;
}
const LEVELS = ["N5", "N4", "N3", "N2", "N1", "unranked"] as const;

export function PageDifficultyPanel({ analysis, vietnamese: vi, expanded, onExpandedChange, loading,
  furiganaLoading, furiganaActive, furiganaMode, furiganaMessage, furiganaError,
  onToggleFurigana, onModeChange, onRescan }: PageDifficultyPanelProps) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => { onExpandedChange(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!expanded) return;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onExpandedChange(false); trigger.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (wrapper.current && !event.composedPath().includes(wrapper.current)) onExpandedChange(false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", outside); };
  }, [expanded, onExpandedChange]);
  const level = LEVELS.includes(analysis.dominantLevel as typeof LEVELS[number]) ? analysis.dominantLevel : "unranked";
  const levelName = analysis.dominantLevel || "—";
  const share = analysis.percentages[level as keyof typeof analysis.percentages] || 0;
  const format = (count: number) => count.toLocaleString(vi ? "vi-VN" : "en-US");
  const modes: Array<[SelectiveFuriganaMode, string]> = [
    ["unlearned", vi ? "Từ / kanji chưa học" : "Unlearned words / kanji"],
    ["n3_plus", vi ? "N3 trở lên" : "N3 and above"],
    ["n2_plus", vi ? "N2 trở lên" : "N2 and above"],
    ["n1_only", vi ? "N1 và từ hiếm" : "N1 and rare words"],
    ["all", vi ? "Tất cả kanji" : "All kanji"],
  ];
  return <div ref={wrapper} className="hk-density-badge hk-difficulty">
    {expanded && <section id={id} className="hk-difficulty__panel" role="dialog" aria-labelledby={`${id}-title`}>
      <header className="hk-difficulty__header">
        <span className="hk-difficulty__icon"><Layers size={18} aria-hidden="true" /></span>
        <div><h2 id={`${id}-title`}>{vi ? "Độ khó trang" : "Page difficulty"}</h2><p>{vi ? "Phân bố từ vựng theo JLPT" : "Vocabulary distribution by JLPT"}</p></div>
        <button ref={closeButton} type="button" className="hk-difficulty__close" onClick={close} aria-label={vi ? "Đóng" : "Close page breakdown"}><X size={16} /></button>
      </header>
      <div className="hk-difficulty__content">
        <div className="hk-difficulty__dominant">
          <span className="hk-difficulty__level" data-level={level}>{levelName}</span>
          <div><span className="hk-difficulty__eyebrow">{analysis.vocabularyStatus === "unavailable" ? (vi ? "Không thể phân tích từ vựng" : "Vocabulary unavailable") : !analysis.dominantLevel ? (vi ? "Chưa đủ dữ liệu" : "Insufficient coverage") : (vi ? "Cấp độ phổ biến nhất" : "Most common level")}</span><p>{analysis.dominantLevel ? (vi ? "Theo số lần xuất hiện của từ" : "By word occurrences") : (vi ? "Độ phủ JLPT" : "JLPT coverage")}</p></div>
          <strong>{analysis.vocabularyStatus === "unavailable" ? "—" : <>{analysis.dominantLevel ? share : Math.floor(analysis.coverage)}<small>%</small></>}</strong>
        </div>
        {!analysis.dominantLevel && analysis.vocabularyStatus === "available" && <p className="hk-difficulty__summary">{vi ? "Cần ít nhất 20 lượt từ và độ phủ JLPT 70%." : "An estimate needs at least 20 words and 70% JLPT coverage."}</p>}
        <div className="hk-difficulty__distribution" role="img" aria-label={LEVELS.map(item => `${item === "unranked" ? (vi ? "Chưa phân loại" : "Unranked") : item}: ${analysis.percentages[item]}%`).join(", ")}>
          {LEVELS.map(item => <span key={item} data-level={item} style={{flex: analysis.jlptDistribution[item]}} />)}
        </div>
        <div className="hk-difficulty__legend">{LEVELS.map(item => <div key={item} data-level={item}><i aria-hidden="true" /><span title={item === "unranked" ? (vi ? "Chưa có phân loại JLPT" : "No JLPT classification") : item}>{item === "unranked" ? (vi ? "Khác" : "Other") : item}</span><strong>{analysis.vocabularyStatus === "available" ? `${analysis.percentages[item]}%` : "—"}</strong></div>)}</div>
        <p className="hk-difficulty__summary">{vi ? "Phạm vi" : "Scope"}: {analysis.scope === "article" ? (vi ? "Bài viết / chương" : "Article / chapter") : analysis.scope === "selection" ? (vi ? "Nội dung đã chọn" : "Selected content") : (vi ? "Văn bản trang hiển thị" : "Visible page text")}</p>
        <dl className="hk-difficulty__stats">
          <div><dt>{vi ? "Lượt từ / từ riêng biệt" : "Words / unique words"}</dt><dd>{analysis.vocabularyStatus === "available" ? <>{format(analysis.totalWords)} <small>/ {format(analysis.uniqueWords)}</small></> : "—"}</dd></div>
          <div><dt>{vi ? "Độ phủ JLPT" : "JLPT coverage"}</dt><dd>{analysis.vocabularyStatus === "available" ? `${Math.floor(analysis.coverage)}%` : "—"}</dd></div>
          <div><dt>{vi ? "Tỷ lệ chữ Nhật" : "Japanese-script density"}</dt><dd>{Math.round(analysis.scriptDensity)}%</dd></div>
          <div><dt>{vi ? "Kanji / riêng biệt" : "Kanji / unique"}</dt><dd>{format(analysis.totalKanji)} <small>/ {format(analysis.uniqueKanji)}</small></dd></div>
        </dl>
        <p className="hk-difficulty__summary">{analysis.familiarity.status === "unavailable"
          ? (vi ? "Dữ liệu SRS không khả dụng" : "SRS familiarity unavailable")
          : (vi ? `Đã vững: ${format(analysis.familiarity.mature)} · Đang học: ${format(analysis.familiarity.learning)} · Chưa lưu: ${format(analysis.familiarity.notSaved)}` : `Mature: ${format(analysis.familiarity.mature)} · Learning: ${format(analysis.familiarity.learning)} · Not saved: ${format(analysis.familiarity.notSaved)}`)}</p>
      </div>
      <div className="hk-difficulty__furigana" data-state={furiganaLoading ? "loading" : furiganaError ? "error" : furiganaActive ? "success" : "default"}>
        <div className="hk-difficulty__control-row"><div><h3>{vi ? "Furigana chọn lọc" : "Selective furigana"}</h3><p>{vi ? "Cách đọc theo trình độ của bạn" : "Readings for your level"}</p></div>
          <button type="button" className="hk-difficulty__toggle" aria-pressed={furiganaActive} aria-label={vi ? "Bật/tắt furigana" : "Toggle furigana"} onClick={onToggleFurigana}>
            {furiganaLoading ? <Loader2 size={15} className="hk-spin" /> : furiganaActive ? <Eye size={15} /> : <EyeOff size={15} />}
            {furiganaLoading ? (vi ? "Hủy" : "Cancel") : furiganaActive ? (vi ? "Bật" : "On") : (vi ? "Tắt" : "Off")}
          </button>
        </div>
        <label htmlFor={`${id}-mode`}>{vi ? "Hiển thị cho" : "Show readings for"}</label>
        <div className="hk-difficulty__select"><select id={`${id}-mode`} value={furiganaMode} aria-label={vi ? "Chế độ furigana" : "Furigana mode"} onChange={event => onModeChange(event.target.value as SelectiveFuriganaMode)}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></div>
        {furiganaLoading && <p className="hk-difficulty__message" role="status">{vi ? "Đang thêm furigana…" : "Adding furigana…"}</p>}
        {furiganaMessage && <p className="hk-difficulty__message" role={furiganaError ? "alert" : "status"}>{furiganaMessage}</p>}
      </div>
      <footer className="hk-difficulty__footer"><span>{vi ? "Ước tính JLPT cộng đồng" : "Community JLPT estimate"}</span><button type="button" onClick={onRescan} disabled={loading}><RefreshCw size={13} className={loading ? "hk-spin" : ""} />{loading ? (vi ? "Đang quét…" : "Scanning…") : (vi ? "Quét lại" : "Rescan")}</button></footer>
    </section>}
    <button ref={trigger} type="button" className="hk-difficulty__trigger" onClick={() => onExpandedChange(!expanded)} aria-expanded={expanded} aria-controls={id} aria-haspopup="dialog" aria-label={vi ? "Độ khó tiếng Nhật của trang" : "Page Japanese breakdown"}>
      <Layers size={16} className="hk-difficulty__brand" aria-hidden="true" /><strong data-level={level}>{analysis.vocabularyStatus === "unavailable" ? (vi ? "Không thể phân tích" : "Analysis unavailable") : analysis.dominantLevel ? levelName : (vi ? "Chưa đủ dữ liệu" : "Insufficient coverage")} {analysis.dominantLevel && <span>· {share}%</span>}</strong><span className="hk-difficulty__trigger-count">{analysis.vocabularyStatus === "available" ? `${format(analysis.totalWords)} ${vi ? "từ" : "words"}` : "—"}</span>{furiganaActive && <Eye size={13} aria-label={vi ? "Furigana đang bật" : "Furigana on"} />}{expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
  </div>;
}
