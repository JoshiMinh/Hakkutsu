import { useEffect, useState } from "react";
import "./dashboard.css";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Film,
  LayoutDashboard,
  Play,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { localSrs, type SrsStats } from "~/features/srs/local-srs";
import { analyticsService } from "./analytics-service";
import { ttsService } from "~/shared/browser/tts-service";
import type { OverallAnalyticsSummary } from "./types";
import { useSettingsStore } from "~/features/settings/settings-store";
import { useTranslation } from "~/shared/locales";
import { JlptBadge } from "~/shared/ui/badges";
import { ActivityHeatmap } from "./activity-heatmap";
import { DashboardForecast, DashboardBreakdown } from "./dashboard-insights";

function formatVideoTime(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}

export function StatsOverview({
  onNavigate,
}: {
  onNavigate?: (tab: "review" | "vocabulary" | "settings") => void;
}) {
  const { t, lang, showHanViet } = useTranslation();
  const srsEnabled = useSettingsStore(
    (state) => state.settings.srsEnabled !== false,
  );
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [analytics, setAnalytics] = useState<OverallAnalyticsSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      localSrs.getSrsStats(),
      analyticsService.getOverallAnalytics().catch(() => null),
    ])
      .then(([srs, activity]) => {
        if (active) {
          setStats(srs);
          setAnalytics(activity);
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : t("popup_error_generic"),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (loading)
    return (
      <div
        className="hk-dashboard hk-dashboard--loading"
        role="status"
        aria-label={t("nav_dashboard")}
        aria-busy="true"
      >
        <div className="hk-dashboard-skeleton hk-dashboard-skeleton--heading" />
        <div className="hk-dashboard-skeleton hk-dashboard-skeleton--session" />
        <div className="hk-dashboard-skeleton hk-dashboard-skeleton--activity" />
      </div>
    );
  if (error || !stats)
    return (
      <div className="hk-dashboard-status" role="alert">
        <p>{error || t("popup_error_generic")}</p>
        <button
          type="button"
          className="hk-btn hk-btn--secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={14} />
          {t("dash_retry")}
        </button>
      </div>
    );

  const recent = stats.recentCards ?? [];
  return (
    <div className="hk-dashboard hk-fade-in">
      <header className="hk-dashboard-heading">
        <div>
          <h2>
            <LayoutDashboard size={21} aria-hidden="true" />
            {t("nav_dashboard")}
          </h2>
          <p className="hk-dashboard-date">
            {new Date().toLocaleDateString(lang, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        {onNavigate && (
          <button
            type="button"
            className="hk-btn hk-btn--ghost hk-btn--sm"
            onClick={() => onNavigate("vocabulary")}
          >
            <BookOpen size={15} />
            {t("nav_vocabulary")}
            <ArrowRight size={14} />
          </button>
        )}
      </header>

      <section
        className="hk-dashboard-session"
        aria-labelledby="dashboard-today"
      >
        <div className="hk-dashboard-session__main">
          <span className="hk-dashboard-eyebrow" id="dashboard-today">
            {t("dash_today")}
          </span>
          <div className="hk-dashboard-session__count">
            <strong>{stats.due.toLocaleString()}</strong>
            <span>{t("dash_cards_due")}</span>
          </div>
          {stats.due === 0 && (
            <p className="hk-dashboard-session__complete">
              <CheckCircle2 size={15} />
              {t("dash_no_reviews_today")}
            </p>
          )}
        </div>
        <div className="hk-dashboard-session__aside">
          <div>
            <strong>{stats.cardsReviewedToday.toLocaleString()}</strong>
            <span>{t("dash_cards_studied")}</span>
          </div>
          {onNavigate && (
            <button
              type="button"
              className="hk-btn hk-btn--primary"
              onClick={() => onNavigate(srsEnabled ? "review" : "settings")}
            >
              {srsEnabled ? <Play size={15} /> : <ArrowRight size={15} />}
              {srsEnabled
                ? t(stats.due > 0 ? "dash_start_review" : "srs_title")
                : t("nav_settings")}
            </button>
          )}
        </div>
      </section>

      <div className="hk-dashboard-workspace">
        <div className="hk-dashboard-main">
          {analytics ? (
            <ActivityHeatmap
              activities={analytics.recentDailyActivities}
              streakDays={analytics.currentStreakDays}
              longestStreakDays={analytics.longestStreakDays}
            />
          ) : (
            <div className="hk-dashboard-notice" role="status">
              <span>{t("dash_analytics_unavailable")}</span>
              <button
                type="button"
                className="hk-btn hk-btn--ghost hk-btn--sm"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("dash_retry")}
              </button>
            </div>
          )}

          <section
            className="hk-dashboard-panel hk-dashboard-recent"
            aria-labelledby="dashboard-recent"
          >
            <header className="hk-dashboard-panel__heading">
              <h3 id="dashboard-recent">{t("dash_recent_vocab")}</h3>
              {onNavigate && (
                <button
                  type="button"
                  className="hk-btn hk-btn--ghost hk-btn--sm"
                  onClick={() => onNavigate("vocabulary")}
                >
                  {t("dash_view_all_vocab")}
                  <ArrowRight size={14} />
                </button>
              )}
            </header>
            {recent.length > 0 ? (
              <ul className="hk-dashboard-words">
                {recent.map((card) => (
                  <li key={card.id}>
                    <div className="hk-dashboard-word">
                      <div className="hk-dashboard-word__heading">
                        <strong lang="ja">{card.word}</strong>
                        {card.reading && <span lang="ja">{card.reading}</span>}
                        {card.jlpt && <JlptBadge level={card.jlpt} />}
                      </div>
                      <p>
                        {showHanViet && card.vietnamese_sound && (
                          <span className="hk-dashboard-word__hanviet">
                            {card.vietnamese_sound} ·{" "}
                          </span>
                        )}
                        {card.meaning || "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="hk-btn hk-btn--ghost hk-btn--icon"
                      aria-label={`${t("def_play_audio_jp")}: ${card.word}`}
                      title={t("def_play_audio_jp")}
                      onClick={() => ttsService.playJapanese(card.word)}
                    >
                      <Volume2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hk-dashboard-empty">{t("vocab_empty")}</p>
            )}
          </section>
        </div>
        <aside className="hk-dashboard-sidebar" aria-label={t("dash_title")}>
          <section
            className="hk-dashboard-panel hk-dashboard-library"
            aria-labelledby="dashboard-library"
          >
            <header className="hk-dashboard-panel__heading">
              <h3 id="dashboard-library">{t("dash_title")}</h3>
            </header>
            <dl className="hk-dashboard-metrics">
              <div>
                <dt>
                  <BookOpen size={15} />
                  {t("dash_total_vocab")}
                </dt>
                <dd>{stats.total.toLocaleString()}</dd>
                <dd className="hk-dashboard-metric__hint">
                  {stats.mined.toLocaleString()} · {t("dash_with_context")}
                </dd>
              </div>
              <div>
                <dt>
                  <BookOpen size={15} />
                  {t("dash_characters")}
                </dt>
                <dd>
                  {analytics
                    ? analytics.totalCharactersRead.toLocaleString()
                    : "—"}
                </dd>
                <dd className="hk-dashboard-metric__hint">
                  {analytics
                    ? `+${analytics.todayCharactersRead.toLocaleString()} · ${t("dash_today")}`
                    : t("dash_analytics_unavailable")}
                </dd>
              </div>
              <div>
                <dt>
                  <Film size={15} />
                  {t("dash_video_time")}
                </dt>
                <dd>
                  {analytics
                    ? formatVideoTime(analytics.totalVideoImmersionSeconds)
                    : "—"}
                </dd>
                <dd className="hk-dashboard-metric__hint">
                  {analytics
                    ? `+${formatVideoTime(analytics.todayVideoImmersionSeconds)} · ${t("dash_today")}`
                    : t("dash_analytics_unavailable")}
                </dd>
              </div>
            </dl>
          </section>
          <DashboardForecast stats={stats} />
          <DashboardBreakdown stats={stats} />
        </aside>
      </div>
    </div>
  );
}

export default StatsOverview;
