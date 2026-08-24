import { useState, useEffect } from "react";
import { localSrs } from "~lib/services/local-srs";
import { Library, Pickaxe, Sprout, BookOpen, RefreshCw, GraduationCap, Loader2 } from "lucide-react";
import { useTranslation } from "~lib/languages/locales";

export function StatsOverview({ userId = "user_1" }: { userId?: string }) {
  const { t, isVietnamese } = useTranslation();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, [userId]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await localSrs.getSrsStats();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <Loader2 className="hk-spin" size={16} style={{ display: "inline-block", marginRight: "8px", verticalAlign: "text-bottom" }} />
        Loading statistics...
      </div>
    );
  }
  if (error) return <div style={{ padding: "40px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>{error}</div>;
  if (!stats) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <StatCard title={t("dash_total_vocab")} value={stats.total} icon={<Library size={24} color="#a855f7" />} color="#a855f7" />
        <StatCard title={t("dash_cards_due")} value={stats.due || 0} icon={<Pickaxe size={24} color="#e85d75" />} color="#e85d75" />
      </div>

      <h3 style={{ marginTop: "16px", marginBottom: "8px", borderBottom: "1px solid var(--hk-border)", paddingBottom: "8px", color: "var(--hk-text-primary)" }}>
        {isVietnamese ? "Phân loại trạng thái ghi nhớ" : "Retention Breakdown"}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <StatCard title={isVietnamese ? "Từ mới" : "New"} value={stats.new || 0} icon={<Sprout size={24} color="#ef4444" />} color="#ef4444" />
        <StatCard title={isVietnamese ? "Đang học" : "Learning"} value={stats.learning || 0} icon={<BookOpen size={24} color="#f59e0b" />} color="#f59e0b" />
        <StatCard title={isVietnamese ? "Đang ôn" : "Reviewing"} value={stats.review || 0} icon={<RefreshCw size={24} color="#3b82f6" />} color="#3b82f6" />
        <StatCard title={isVietnamese ? "Thành thục" : "Graduated"} value={stats.graduated || 0} icon={<GraduationCap size={24} color="#10b981" />} color="#10b981" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "24px" }}>
        {/* Retention Ring */}
        <div style={{ backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)", padding: "24px", display: "flex", gap: "32px", alignItems: "center" }}>
          <DonutChart newCount={stats.new || 0} learning={stats.learning || 0} review={stats.review || 0} graduated={stats.graduated || 0} total={stats.total} />
          
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
            <h4 style={{ margin: "0", color: "var(--hk-text-primary)" }}>{isVietnamese ? "Phân bổ độ trưởng thành thẻ" : "Maturity Distribution"}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }}/> {isVietnamese ? "Từ mới" : "New"}: <b>{stats.new || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }}/> {isVietnamese ? "Đang học" : "Learning"}: <b>{stats.learning || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }}/> {isVietnamese ? "Đang ôn" : "Review"}: <b>{stats.review || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }}/> {isVietnamese ? "Thành thục" : "Graduated"}: <b>{stats.graduated || 0}</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: number | string; icon: React.ReactNode; color: string }) {
  return (
    <div style={{
      backgroundColor: "var(--hk-bg-secondary)",
      border: "1px solid var(--hk-border)",
      borderRadius: "12px",
      padding: "20px",
      display: "flex",
      alignItems: "center",
      gap: "16px"
    }}>
      <div style={{
        width: "48px",
        height: "48px",
        borderRadius: "8px",
        backgroundColor: `${color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "12px", color: "var(--hk-text-muted)", fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--hk-text-primary)", marginTop: "2px" }}>{value}</div>
      </div>
    </div>
  );
}

function DonutChart({ newCount, learning, review, graduated, total }: { newCount: number; learning: number; review: number; graduated: number; total: number }) {
  if (!total) {
    return (
      <div style={{ width: "120px", height: "120px", borderRadius: "50%", border: "8px solid var(--hk-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "12px", color: "var(--hk-text-muted)" }}>0%</span>
      </div>
    );
  }

  const pNew = (newCount / total) * 100;
  const pLearning = (learning / total) * 100;
  const pReview = (review / total) * 100;
  const pGrad = (graduated / total) * 100;

  const bg = `conic-gradient(
    #ef4444 0% ${pNew}%,
    #f59e0b ${pNew}% ${pNew + pLearning}%,
    #3b82f6 ${pNew + pLearning}% ${pNew + pLearning + pReview}%,
    #10b981 ${pNew + pLearning + pReview}% 100%
  )`;

  return (
    <div style={{ position: "relative", width: "120px", height: "120px", borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "84px", height: "84px", borderRadius: "50%", backgroundColor: "var(--hk-bg-secondary)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "16px", fontWeight: "bold", color: "var(--hk-text-primary)" }}>{Math.round(pGrad)}%</span>
        <span style={{ fontSize: "10px", color: "var(--hk-text-muted)" }}>Mastered</span>
      </div>
    </div>
  );
}
