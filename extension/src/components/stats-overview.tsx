import { useState, useEffect } from "react";
import { localSrs, type SrsStats } from "~lib/services/local-srs";
import { 
  Play,
  Volume2, 
  ArrowRight,
  Sparkles,
  BookOpen,
  Calendar,
  Layers,
  CheckCircle2,
  Clock,
  LayoutDashboard
} from "lucide-react";
import { useTranslation } from "~lib/languages/locales";
import { JlptBadge } from "~components/Badges";
import { ttsService } from "~lib/services/tts-service";

export function StatsOverview({ 
  onNavigate 
}: { 
  onNavigate?: (tab: "review" | "vocabulary" | "settings") => void 
}) {
  const { t, isVietnamese, showHanViet } = useTranslation();
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await localSrs.getSrsStats();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--hk-text-muted)" }}>
        <div className="hk-loading-spinner" style={{ margin: "0 auto 12px" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "30px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", paddingBottom: "32px" }} className="hk-fade-in">
      
      {/* ── Header Toolbar: Clean & Purposeful ─────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "14px",
        paddingBottom: "4px"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "4px" }}>
            <LayoutDashboard size={20} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
              {t("nav_dashboard")}
            </h2>
          </div>
          <p style={{ fontSize: "12.5px", color: "var(--hk-text-muted)", margin: 0 }}>
            {isVietnamese 
              ? "Theo dõi tiến độ ghi nhớ SRS và kho từ vựng tiếng Nhật" 
              : "Track your Spaced Repetition progress and vocabulary mastery"}
          </p>
        </div>

        {onNavigate && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => onNavigate("review")}
              className="hk-btn hk-btn--primary"
              style={{
                padding: "8px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                borderRadius: "8px",
                gap: "6px"
              }}
            >
              <Play size={13} fill="currentColor" />
              {stats.due > 0 ? `${t("dash_start_review")} (${stats.due})` : t("srs_title")}
            </button>
            <button
              onClick={() => onNavigate("vocabulary")}
              className="hk-btn hk-btn--secondary"
              style={{
                padding: "8px 14px",
                fontSize: "12.5px",
                borderRadius: "8px",
                gap: "6px"
              }}
            >
              <BookOpen size={13} />
              {t("nav_vocabulary")}
            </button>
          </div>
        )}
      </div>

      {/* ── Key Metrics: Clean Minimalist Tiles ────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        <StatTile 
          label={t("dash_total_vocab")} 
          value={stats.total} 
          hint={isVietnamese ? `${stats.mined} câu ví dụ` : `${stats.mined} with context`}
        />
        <StatTile 
          label={t("dash_cards_due")} 
          value={stats.due} 
          valueColor={stats.due > 0 ? "#f43f5e" : "#10b981"}
          hint={stats.due > 0 ? (isVietnamese ? "Cần hoàn thành" : "Pending reviews") : (isVietnamese ? "Đã xong hôm nay" : "All completed")}
        />
        <StatTile 
          label={t("dash_cards_studied")} 
          value={stats.cardsReviewedToday} 
          hint={isVietnamese ? `${stats.streakDays} ngày liên tiếp` : `${stats.streakDays} day streak`}
        />
        <StatTile 
          label={t("dash_retention")} 
          value={`${stats.retentionRate}%`} 
          valueColor="#38bdf8"
          hint={isVietnamese ? "Thành thục & Đang ôn" : "Mature retention"}
        />
      </div>

      {/* ── Forecast & JLPT Breakdown ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px" }}>
        
        {/* 7-Day Forecast */}
        <div style={{
          background: "var(--hk-bg-secondary)",
          border: "1px solid var(--hk-border)",
          borderRadius: "10px",
          padding: "18px 20px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Calendar size={15} style={{ color: "var(--hk-accent-primary)" }} />
            <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 600, color: "#ffffff" }}>
              {t("dash_forecast_title")}
            </h3>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: "110px", gap: "6px", paddingBottom: "4px" }}>
            {stats.forecast.map((count, index) => {
              const maxVal = Math.max(1, ...stats.forecast);
              const heightPercent = Math.max(10, Math.round((count / maxVal) * 100));
              const isToday = index === 0;

              return (
                <div key={index} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", height: "100%", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 600, color: isToday ? "var(--hk-accent-primary)" : "var(--hk-text-muted)" }}>
                    {count}
                  </span>
                  <div style={{
                    width: "100%",
                    maxWidth: "28px",
                    height: `${heightPercent}%`,
                    borderRadius: "4px 4px 2px 2px",
                    background: isToday ? "var(--hk-accent-primary)" : "rgba(255, 255, 255, 0.08)",
                    transition: "all 0.2s ease"
                  }} />
                  <span style={{ fontSize: "10px", color: isToday ? "var(--hk-accent-primary)" : "var(--hk-text-muted)", fontWeight: isToday ? 600 : 400 }}>
                    {isToday ? t("dash_today") : `+${index}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* JLPT Breakdown */}
        <div style={{
          background: "var(--hk-bg-secondary)",
          border: "1px solid var(--hk-border)",
          borderRadius: "10px",
          padding: "18px 20px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <Layers size={15} style={{ color: "#38bdf8" }} />
            <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 600, color: "#ffffff" }}>
              {t("dash_jlpt_mastery")}
            </h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              { level: "N5", count: stats.jlptCounts.N5, color: "#10b981" },
              { level: "N4", count: stats.jlptCounts.N4, color: "#06b6d4" },
              { level: "N3", count: stats.jlptCounts.N3, color: "#3b82f6" },
              { level: "N2", count: stats.jlptCounts.N2, color: "#f59e0b" },
              { level: "N1", count: stats.jlptCounts.N1, color: "#ef4444" },
            ].map(item => {
              const percent = stats.total > 0 ? Math.round((item.count / stats.total) * 100) : 0;
              return (
                <div key={item.level} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ 
                    width: "28px", 
                    fontSize: "10.5px", 
                    fontWeight: 700, 
                    color: item.color
                  }}>
                    {item.level}
                  </span>
                  
                  <div style={{ flex: 1, height: "6px", background: "rgba(255, 255, 255, 0.05)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{
                      width: `${percent}%`,
                      height: "100%",
                      borderRadius: "3px",
                      background: item.color,
                      transition: "width 0.3s ease"
                    }} />
                  </div>
                  
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--hk-text-primary)", width: "45px", textAlign: "right" }}>
                    {item.count} <span style={{ color: "var(--hk-text-muted)", fontSize: "9.5px", fontWeight: 400 }}>({percent}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Card Maturity ──────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--hk-bg-secondary)",
        border: "1px solid var(--hk-border)",
        borderRadius: "10px",
        padding: "16px 18px"
      }}>
        <div style={{ fontSize: "12px", color: "var(--hk-text-muted)", marginBottom: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {t("dash_maturity_title")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
          <MaturityTile label={t("dash_maturity_new")} count={stats.new} color="#ef4444" total={stats.total} />
          <MaturityTile label={t("dash_maturity_learning")} count={stats.learning} color="#f59e0b" total={stats.total} />
          <MaturityTile label={t("dash_maturity_review")} count={stats.review} color="#3b82f6" total={stats.total} />
          <MaturityTile label={t("dash_maturity_graduated")} count={stats.graduated} color="#10b981" total={stats.total} />
        </div>
      </div>

      {/* ── Recent Cards Preview ───────────────────────────────────────────── */}
      {stats.recentCards && stats.recentCards.length > 0 && (
        <div style={{
          background: "var(--hk-bg-secondary)",
          border: "1px solid var(--hk-border)",
          borderRadius: "10px",
          padding: "18px 20px"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <Clock size={14} style={{ color: "var(--hk-accent-primary)" }} />
              <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 600, color: "#ffffff" }}>
                {t("dash_recent_vocab")}
              </h3>
            </div>

            {onNavigate && (
              <button
                onClick={() => onNavigate("vocabulary")}
                className="hk-btn hk-btn--ghost hk-btn--sm"
                style={{ fontSize: "11.5px", gap: "4px", color: "var(--hk-accent-primary)", padding: "2px 6px" }}
              >
                {t("dash_view_all_vocab")} <ArrowRight size={12} />
              </button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px" }}>
            {stats.recentCards.map((card) => (
              <div
                key={card.id}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px"
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                    <span style={{
                      fontFamily: "var(--hk-font-jp)",
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#ffffff"
                    }}>
                      {card.word}
                    </span>
                    {card.reading && (
                      <span style={{ fontSize: "11.5px", color: "#f472b6", fontFamily: "var(--hk-font-jp)" }}>
                        {card.reading}
                      </span>
                    )}
                    {card.jlpt && <JlptBadge level={card.jlpt} />}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {showHanViet && card.vietnamese_sound && (
                      <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#38bdf8", padding: "1px 3px", background: "rgba(56, 189, 248, 0.1)", borderRadius: "3px" }}>
                        {card.vietnamese_sound}
                      </span>
                    )}
                    <span style={{ fontSize: "11.5px", color: "var(--hk-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>
                      {card.meaning || "—"}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => ttsService.playJapanese(card.word)}
                  className="hk-btn hk-btn--ghost hk-btn--icon"
                  style={{ padding: "5px", color: "var(--hk-text-muted)", flexShrink: 0 }}
                  title="Play Japanese pronunciation"
                >
                  <Volume2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ 
  label, 
  value, 
  hint, 
  valueColor = "#ffffff" 
}: { 
  label: string; 
  value: number | string; 
  hint?: string; 
  valueColor?: string; 
}) {
  return (
    <div style={{
      background: "var(--hk-bg-secondary)",
      border: "1px solid var(--hk-border)",
      borderRadius: "8px",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    }}>
      <div style={{ fontSize: "11.5px", color: "var(--hk-text-muted)", fontWeight: 500, marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 800, color: valueColor, lineHeight: "1.1", marginBottom: "4px" }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: "10.5px", color: "var(--hk-text-muted)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function MaturityTile({ 
  label, 
  count, 
  color, 
  total 
}: { 
  label: string; 
  count: number; 
  color: string; 
  total: number; 
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{
      background: "rgba(255, 255, 255, 0.02)",
      border: "1px solid rgba(255, 255, 255, 0.04)",
      borderRadius: "6px",
      padding: "10px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color }} />
        <span style={{ fontSize: "11.5px", color: "var(--hk-text-primary)" }}>{label}</span>
      </div>
      <span style={{ fontSize: "12px", fontWeight: 700, color: "#ffffff" }}>
        {count} <span style={{ color: "var(--hk-text-muted)", fontSize: "9.5px", fontWeight: 400 }}>({percent}%)</span>
      </span>
    </div>
  );
}
