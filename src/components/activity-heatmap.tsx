import { useState } from "react";
import type { DailyActivity } from "~lib/utils/types";
import { Flame, Calendar as CalendarIcon, BookOpen, Film, BookmarkPlus, Brain } from "lucide-react";
import { useTranslation } from "~lib/locales";

interface ActivityHeatmapProps {
  activities: DailyActivity[];
  streakDays?: number;
  longestStreakDays?: number;
}

type MetricType = "all" | "characters" | "video" | "mining" | "reviews";

export function ActivityHeatmap({
  activities,
  streakDays = 0,
  longestStreakDays = 0,
}: ActivityHeatmapProps) {
  const { t, isVietnamese } = useTranslation();
  const [selectedMetric, setSelectedMetric] = useState<MetricType>("all");
  const [hoveredDay, setHoveredDay] = useState<{
    activity: DailyActivity;
    x: number;
    y: number;
  } | null>(null);

  // Group into weeks (7 days per column, Mon to Sun)
  const daysToShow = activities.slice(-119); // 17 weeks = 119 days

  // Compute activity value for a given day based on active metric
  const getMetricValue = (act: DailyActivity, metric: MetricType): number => {
    switch (metric) {
      case "characters":
        return act.charactersRead || 0;
      case "video":
        return Math.round((act.videoImmersionSeconds || 0) / 60); // in minutes
      case "mining":
        return act.miningVolume || 0;
      case "reviews":
        return act.reviewsCount || 0;
      case "all":
      default: {
        const charScore = Math.min(40, (act.charactersRead || 0) / 25);
        const videoScore = Math.min(30, (act.videoImmersionSeconds || 0) / 60);
        const mineScore = (act.miningVolume || 0) * 5;
        const reviewScore = (act.reviewsCount || 0) * 2;
        return Math.round(charScore + videoScore + mineScore + reviewScore);
      }
    }
  };

  // Find max value in dataset to normalize 0-4 intensity scale
  const maxVal = Math.max(
    1,
    ...daysToShow.map((a) => getMetricValue(a, selectedMetric))
  );

  const getIntensityLevel = (val: number): number => {
    if (val <= 0) return 0;
    const ratio = val / maxVal;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  };

  const getCellColor = (level: number): string => {
    switch (level) {
      case 1:
        return "rgba(168, 85, 247, 0.3)";
      case 2:
        return "rgba(168, 85, 247, 0.55)";
      case 3:
        return "rgba(168, 85, 247, 0.8)";
      case 4:
        return "#c084fc";
      case 0:
      default:
        return "rgba(255, 255, 255, 0.04)";
    }
  };

  // Split into columns of 7 days
  const weeks: DailyActivity[][] = [];
  for (let i = 0; i < daysToShow.length; i += 7) {
    weeks.push(daysToShow.slice(i, i + 7));
  }

  const formatVideoTime = (seconds: number): string => {
    if (!seconds || seconds <= 0) return "0m";
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0) return `${hrs}h ${remMins}m`;
    return `${mins}m`;
  };

  return (
    <div
      style={{
        background: "var(--hk-bg-secondary)",
        border: "1px solid var(--hk-border)",
        borderRadius: "10px",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {/* Top Header & Metric Selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <CalendarIcon size={16} style={{ color: "var(--hk-accent-primary)" }} />
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>
            {isVietnamese ? "Lịch Hoạt Động & Chăm Chỉ" : "Immersion & Study Activity"}
          </h3>
        </div>

        {/* Streaks pill */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "20px",
              padding: "3px 10px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#f87171",
            }}
          >
            <Flame size={13} fill="currentColor" />
            <span>
              {streakDays} {isVietnamese ? "ngày streak" : "day streak"}
            </span>
            {longestStreakDays > 0 && (
              <span style={{ color: "var(--hk-text-muted)", fontWeight: 400 }}>
                ({isVietnamese ? "kỷ lục" : "best"}: {longestStreakDays}d)
              </span>
            )}
          </div>

          {/* Metric Filter Tabs */}
          <div
            style={{
              display: "flex",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: "6px",
              padding: "2px",
              gap: "2px",
            }}
          >
            <MetricButton
              active={selectedMetric === "all"}
              onClick={() => setSelectedMetric("all")}
              label={isVietnamese ? "Tổng hợp" : "All Activity"}
            />
            <MetricButton
              active={selectedMetric === "characters"}
              onClick={() => setSelectedMetric("characters")}
              icon={<BookOpen size={12} />}
              label={isVietnamese ? "Ký tự" : "Characters"}
            />
            <MetricButton
              active={selectedMetric === "video"}
              onClick={() => setSelectedMetric("video")}
              icon={<Film size={12} />}
              label={isVietnamese ? "Video" : "Video"}
            />
            <MetricButton
              active={selectedMetric === "mining"}
              onClick={() => setSelectedMetric("mining")}
              icon={<BookmarkPlus size={12} />}
              label={isVietnamese ? "Mined" : "Mined"}
            />
            <MetricButton
              active={selectedMetric === "reviews"}
              onClick={() => setSelectedMetric("reviews")}
              icon={<Brain size={12} />}
              label={isVietnamese ? "SRS" : "Reviews"}
            />
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div style={{ overflowX: "auto", paddingBottom: "4px" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: "3px" }}>
          {/* 7 rows for days of the week */}
          {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => (
            <div key={dayOfWeek} style={{ display: "flex", gap: "3px", alignItems: "center" }}>
              {/* Day of week indicator for Mon, Wed, Fri */}
              <span
                style={{
                  width: "22px",
                  fontSize: "9px",
                  color: "var(--hk-text-muted)",
                  userSelect: "none",
                }}
              >
                {dayOfWeek === 1 ? "Mon" : dayOfWeek === 3 ? "Wed" : dayOfWeek === 5 ? "Fri" : ""}
              </span>

              {weeks.map((week, wIdx) => {
                const dayAct = week[dayOfWeek];
                if (!dayAct) {
                  return <div key={wIdx} style={{ width: "12px", height: "12px" }} />;
                }

                const val = getMetricValue(dayAct, selectedMetric);
                const level = getIntensityLevel(val);
                const color = getCellColor(level);

                return (
                  <div
                    key={dayAct.date}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredDay({
                        activity: dayAct,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                      });
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "2px",
                      backgroundColor: color,
                      cursor: "pointer",
                      border:
                        level > 0
                          ? "1px solid rgba(168, 85, 247, 0.4)"
                          : "1px solid rgba(255, 255, 255, 0.03)",
                      transition: "transform 0.1s ease, background-color 0.15s ease",
                      boxShadow: level === 4 ? "0 0 6px rgba(192, 132, 252, 0.4)" : "none",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend & Stats Footnote */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "var(--hk-text-muted)",
          paddingTop: "4px",
          borderTop: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        <span>
          {isVietnamese
            ? "Màu càng đậm thể hiện lượng tiếp xúc tiếng Nhật càng cao"
            : "Color intensity reflects Japanese immersion & mining activity"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span>{isVietnamese ? "Ít" : "Less"}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <div
              key={lvl}
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "2px",
                backgroundColor: getCellColor(lvl),
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            />
          ))}
          <span>{isVietnamese ? "Nhiều" : "More"}</span>
        </div>
      </div>

      {/* Interactive Tooltip Popover */}
      {hoveredDay && (
        <div
          style={{
            position: "fixed",
            left: `${hoveredDay.x}px`,
            top: `${hoveredDay.y - 12}px`,
            transform: "translate(-50%, -100%)",
            background: "#18181c",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            padding: "8px 12px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.6)",
            pointerEvents: "none",
            zIndex: 99999,
            fontSize: "11.5px",
            color: "#ffffff",
            minWidth: "170px",
          }}
          className="hk-fade-in"
        >
          <div style={{ fontWeight: 700, color: "var(--hk-accent-light, #c084fc)", marginBottom: "4px" }}>
            {hoveredDay.activity.date}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px" }}>
            <div>
              📖 {isVietnamese ? "Ký tự đã đọc" : "Chars read"}: <b>{hoveredDay.activity.charactersRead.toLocaleString()}</b>
            </div>
            <div>
              🎬 {isVietnamese ? "Thời gian xem" : "Video immersion"}: <b>{formatVideoTime(hoveredDay.activity.videoImmersionSeconds)}</b>
            </div>
            <div>
              📥 {isVietnamese ? "Từ đã lưu" : "Cards mined"}: <b>{hoveredDay.activity.miningVolume}</b>
            </div>
            <div>
              🧠 {isVietnamese ? "Ôn tập SRS" : "SRS reviews"}: <b>{hoveredDay.activity.reviewsCount}</b>{" "}
              {hoveredDay.activity.reviewsCount > 0 && (
                <span style={{ color: "#38bdf8" }}>({hoveredDay.activity.retentionRate}% pass)</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "rgba(168, 85, 247, 0.25)" : "transparent",
        border: "none",
        color: active ? "#ffffff" : "var(--hk-text-muted)",
        fontSize: "11px",
        fontWeight: active ? 600 : 400,
        padding: "3px 8px",
        borderRadius: "4px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        transition: "all 0.15s ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
