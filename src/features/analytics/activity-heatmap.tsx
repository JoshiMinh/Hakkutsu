import { useState } from "react";
import { Calendar, Flame } from "lucide-react";
import type { DailyActivity } from "./types";
import { useTranslation } from "~/shared/locales";

type MetricType = "all" | "characters" | "video" | "mining" | "reviews";

function metricValue(activity: DailyActivity, metric: MetricType): number {
  if (metric === "characters") return activity.charactersRead || 0;
  if (metric === "video")
    return Math.round((activity.videoImmersionSeconds || 0) / 60);
  if (metric === "mining") return activity.miningVolume || 0;
  if (metric === "reviews") return activity.reviewsCount || 0;
  return Math.round(
    Math.min(40, (activity.charactersRead || 0) / 25) +
      Math.min(30, (activity.videoImmersionSeconds || 0) / 60) +
      (activity.miningVolume || 0) * 5 +
      (activity.reviewsCount || 0) * 2,
  );
}

export function ActivityHeatmap({
  activities,
  streakDays = 0,
  longestStreakDays = 0,
}: {
  activities: DailyActivity[];
  streakDays?: number;
  longestStreakDays?: number;
}) {
  const { t, lang } = useTranslation();
  const [metric, setMetric] = useState<MetricType>("all");
  const days = activities.slice(-119);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected =
    days.find((day) => day.date === selectedDate) ?? days[days.length - 1];
  const maximum = Math.max(1, ...days.map((day) => metricValue(day, metric)));
  const first = days[0] ? new Date(`${days[0].date}T00:00:00`) : null;
  const offset = first ? (first.getDay() + 6) % 7 : 0;
  const cells: Array<DailyActivity | null> = [
    ...Array.from({ length: offset }, () => null),
    ...days,
  ];
  const weeks: Array<Array<DailyActivity | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    const week = cells.slice(index, index + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  const options: Array<{ value: MetricType; label: string }> = [
    { value: "all", label: t("dash_recent_activity") },
    { value: "characters", label: t("dash_characters") },
    { value: "video", label: t("dash_video_time") },
    { value: "mining", label: t("dash_total_vocab") },
    { value: "reviews", label: t("nav_review") },
  ];

  const moveFocus = (date: string, direction: number) => {
    const index = days.findIndex((day) => day.date === date);
    const next =
      days[Math.max(0, Math.min(days.length - 1, index + direction))];
    if (next) {
      setSelectedDate(next.date);
      document.getElementById(`dashboard-day-${next.date}`)?.focus();
    }
  };

  return (
    <section
      className="hk-dashboard-panel hk-dashboard-activity"
      aria-labelledby="dashboard-activity"
    >
      <header className="hk-dashboard-panel__heading">
        <h3 id="dashboard-activity">
          <Calendar size={16} aria-hidden="true" />
          {t("dash_recent_activity")}
        </h3>
        <select
          className="hk-dashboard-activity__filter"
          aria-label={t("dash_recent_activity")}
          value={metric}
          onChange={(event) => setMetric(event.target.value as MetricType)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>
      <div className="hk-dashboard-streak">
        <Flame size={15} aria-hidden="true" />
        <strong>{streakDays}</strong>
        <span>{t("dash_streak_days")}</span>
        {longestStreakDays > 0 && (
          <span className="hk-dashboard-streak__best">
            {t("dash_longest_streak")}: {longestStreakDays}
          </span>
        )}
      </div>
      {weeks.length > 0 ? (
        <div
          className="hk-dashboard-calendar"
          style={{
            gridTemplateColumns: `28px repeat(${weeks.length}, minmax(12px, 1fr))`,
          }}
        >
          <div className="hk-dashboard-calendar__labels" aria-hidden="true">
            <span />
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>
                {index % 2 === 0
                  ? new Date(2024, 0, 1 + index).toLocaleDateString(lang, {
                      weekday: "narrow",
                    })
                  : ""}
              </span>
            ))}
          </div>
          {weeks.map((week, weekIndex) => {
            const date = week.find((day) => day)?.date;
            const previous = weeks[weekIndex - 1]?.find((day) => day)?.date;
            const month =
              date && (!previous || date.slice(0, 7) !== previous.slice(0, 7))
                ? new Date(`${date}T00:00:00`).toLocaleDateString(lang, {
                    month: "short",
                  })
                : "";
            return (
              <div className="hk-dashboard-calendar__week" key={weekIndex}>
                <span
                  className="hk-dashboard-calendar__month"
                  aria-hidden="true"
                >
                  {month}
                </span>
                {week.map((day, dayIndex) => {
                  if (!day)
                    return (
                      <span
                        key={dayIndex}
                        className="hk-dashboard-calendar__blank"
                      />
                    );
                  const value = metricValue(day, metric);
                  const intensity =
                    value === 0
                      ? 0
                      : Math.min(4, Math.ceil((value / maximum) * 4));
                  return (
                    <button
                      type="button"
                      id={`dashboard-day-${day.date}`}
                      key={day.date}
                      className={`hk-dashboard-calendar__day hk-dashboard-intensity--${intensity}`}
                      tabIndex={selected?.date === day.date ? 0 : -1}
                      aria-label={`${new Date(`${day.date}T00:00:00`).toLocaleDateString(lang)}: ${value} ${options.find((option) => option.value === metric)?.label}`}
                      aria-pressed={selected?.date === day.date}
                      onClick={() => setSelectedDate(day.date)}
                      onFocus={() => setSelectedDate(day.date)}
                      onKeyDown={(event) => {
                        const direction =
                          event.key === "ArrowRight"
                            ? 7
                            : event.key === "ArrowLeft"
                              ? -7
                              : event.key === "ArrowDown"
                                ? 1
                                : event.key === "ArrowUp"
                                  ? -1
                                  : 0;
                        if (direction) {
                          event.preventDefault();
                          moveFocus(day.date, direction);
                        }
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hk-dashboard-empty">{t("dash_activity_empty")}</p>
      )}
      {selected && (
        <div className="hk-dashboard-day-summary" aria-live="polite">
          <time dateTime={selected.date}>
            {new Date(`${selected.date}T00:00:00`).toLocaleDateString(lang, {
              month: "short",
              day: "numeric",
            })}
          </time>
          <dl>
            <div>
              <dt>{t("dash_characters")}</dt>
              <dd>{selected.charactersRead.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t("dash_video_time")}</dt>
              <dd>{Math.floor(selected.videoImmersionSeconds / 60)}m</dd>
            </div>
            <div>
              <dt>{t("dash_total_vocab")}</dt>
              <dd>{selected.miningVolume}</dd>
            </div>
            <div>
              <dt>{t("nav_review")}</dt>
              <dd>{selected.reviewsCount}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
