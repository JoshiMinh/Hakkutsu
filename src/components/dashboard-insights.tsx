import { AlertTriangle, Calendar, Layers } from "lucide-react";
import type { SrsStats } from "~lib/services/local-srs";
import { useTranslation } from "~lib/locales";

export function DashboardForecast({ stats }: { stats: SrsStats }) {
  const { t, lang } = useTranslation();
  const forecast = Array.from(
    { length: 7 },
    (_, index) => stats.forecast[index] ?? 0,
  );
  const max = Math.max(1, ...forecast);
  return (
    <section
      className="hk-dashboard-panel"
      aria-labelledby="dashboard-forecast"
    >
      <header className="hk-dashboard-panel__heading">
        <h3 id="dashboard-forecast">
          <Calendar size={16} />
          {t("dash_forecast_title")}
        </h3>
      </header>
      <p className="hk-dashboard-panel__description">
        {t("dash_forecast_desc")}
      </p>
      <div className="hk-dashboard-forecast">
        {forecast.map((count, index) => {
          const date = new Date();
          date.setDate(date.getDate() + index);
          const label =
            index === 0
              ? t("dash_today")
              : date.toLocaleDateString(lang, { weekday: "short" });
          return (
            <div
              className={`hk-dashboard-forecast__day ${index === 0 ? "hk-dashboard-forecast__day--today" : ""}`}
              key={index}
              aria-label={`${date.toLocaleDateString(lang)}: ${count}`}
            >
              <strong>{count}</strong>
              <div className="hk-dashboard-forecast__track">
                <span style={{ height: `${(count / max) * 100}%` }} />
              </div>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardBreakdown({ stats }: { stats: SrsStats }) {
  const { t } = useTranslation();
  const levels = ["N5", "N4", "N3", "N2", "N1"] as const;
  const unranked = Math.max(
    0,
    stats.total -
      levels.reduce((sum, level) => sum + stats.jlptCounts[level], 0),
  );
  return (
    <section className="hk-dashboard-panel" aria-labelledby="dashboard-jlpt">
      <header className="hk-dashboard-panel__heading">
        <h3 id="dashboard-jlpt">
          <Layers size={16} />
          {t("dash_jlpt_mastery")}
        </h3>
      </header>
      <p className="hk-dashboard-panel__description">
        {t("dash_jlpt_mastery_sub")}
      </p>
      <dl className="hk-dashboard-levels">
        {levels.map((level) => {
          const count = stats.jlptCounts[level];
          const percent =
            stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
          return (
            <div key={level}>
              <dt className={`hk-dashboard-level--${level.toLowerCase()}`}>
                {level}
              </dt>
              <dd>
                <div className="hk-dashboard-level__track" aria-hidden="true">
                  <span
                    className={`hk-dashboard-level--${level.toLowerCase()}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <strong>{count}</strong>
                <span>{percent}%</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="hk-dashboard-unranked">
        <span>{t("dash_unranked")}</span>
        <strong>{unranked}</strong>
      </div>
      <div className="hk-dashboard-maturity">
        <h4>{t("dash_maturity_title")}</h4>
        <div className="hk-dashboard-maturity__bar" aria-hidden="true">
          {[
            [stats.new, "new"],
            [stats.learning, "learning"],
            [stats.review, "review"],
            [stats.graduated, "graduated"],
          ].map(([count, state]) => (
            <span
              key={state}
              className={`hk-dashboard-state--${state}`}
              style={{
                width: `${stats.total ? (Number(count) / stats.total) * 100 : 0}%`,
              }}
            />
          ))}
        </div>
        <dl className="hk-dashboard-maturity__legend">
          {[
            { key: "new", label: t("dash_maturity_new"), count: stats.new },
            {
              key: "learning",
              label: t("dash_maturity_learning"),
              count: stats.learning,
            },
            {
              key: "review",
              label: t("dash_maturity_review"),
              count: stats.review,
            },
            {
              key: "graduated",
              label: t("dash_maturity_graduated"),
              count: stats.graduated,
            },
          ].map((item) => (
            <div key={item.key}>
              <dt>
                <i className={`hk-dashboard-state--${item.key}`} />
                {item.label}
              </dt>
              <dd>{item.count}</dd>
            </div>
          ))}
        </dl>
      </div>
      {stats.leechCount > 0 && (
        <p className="hk-dashboard-leech">
          <AlertTriangle size={15} />
          {t("dash_leeches")}: <strong>{stats.leechCount}</strong>
        </p>
      )}
    </section>
  );
}
