import { useState, useEffect } from "react";
import { localSrs } from "~lib/services/local-srs";
import { Library, Pickaxe, Sprout, BookOpen, RefreshCw, GraduationCap, Loader2 } from "lucide-react";

export function StatsOverview({ userId = "user_1" }: { userId?: string }) {
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

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}><Loader2 className="hk-spin" size={16} style={{ display: "inline-block", marginRight: "8px", verticalAlign: "text-bottom" }} /> Loading statistics...</div>;
  if (error) return <div style={{ padding: "40px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>{error}</div>;
  if (!stats) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <StatCard title="Total Words" value={stats.total} icon={<Library size={24} color="#a855f7" />} color="#a855f7" />
        <StatCard title="Mined Sentences" value={stats.mined || 0} icon={<Pickaxe size={24} color="#e85d75" />} color="#e85d75" />
      </div>

      <h3 style={{ marginTop: "16px", marginBottom: "8px", borderBottom: "1px solid var(--hk-border)", paddingBottom: "8px", color: "var(--hk-text-primary)" }}>
        Retention Breakdown
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <StatCard title="New" value={stats.new || 0} icon={<Sprout size={24} color="#ef4444" />} color="#ef4444" />
        <StatCard title="Learning" value={stats.learning || 0} icon={<BookOpen size={24} color="#f59e0b" />} color="#f59e0b" />
        <StatCard title="Reviewing" value={stats.review || 0} icon={<RefreshCw size={24} color="#3b82f6" />} color="#3b82f6" />
        <StatCard title="Graduated" value={stats.graduated || 0} icon={<GraduationCap size={24} color="#10b981" />} color="#10b981" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "24px" }}>
        {/* Retention Ring */}
        <div style={{ backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)", padding: "24px", display: "flex", gap: "32px", alignItems: "center" }}>
          <DonutChart newCount={stats.new || 0} learning={stats.learning || 0} review={stats.review || 0} graduated={stats.graduated || 0} total={stats.total} />
          
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
            <h4 style={{ margin: "0", color: "var(--hk-text-primary)" }}>Maturity Distribution</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }}/> New: <b>{stats.new || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }}/> Learning: <b>{stats.learning || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }}/> Review: <b>{stats.review || 0}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }}/> Graduated: <b>{stats.graduated || 0}</b></div>
            </div>
          </div>
        </div>

        {/* Forecast Bar Chart */}
        <div style={{ backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)", padding: "24px" }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--hk-text-primary)" }}>Upcoming Reviews Forecast</h4>
          <div style={{ fontSize: "13px", color: "var(--hk-text-muted)" }}>Next 7 Days</div>
          <ForecastBarChart forecast={stats.forecast || Array(7).fill(0)} />
        </div>
      </div>
    </div>
  );
}

function DonutChart({ newCount, learning, review, graduated, total }: any) {
  if (!total || total === 0) {
    return <div style={{ width: "120px", height: "120px", borderRadius: "50%", border: "4px solid var(--hk-border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--hk-text-muted)", fontSize: "12px" }}>No Data</div>;
  }
  const pNew = (newCount / total) * 100;
  const pLearning = (learning / total) * 100;
  const pReview = (review / total) * 100;
  const pGrad = (graduated / total) * 100;
  
  const gradient = `conic-gradient(
    #ef4444 0% ${pNew}%, 
    #f59e0b ${pNew}% ${pNew + pLearning}%, 
    #3b82f6 ${pNew + pLearning}% ${pNew + pLearning + pReview}%, 
    #10b981 ${pNew + pLearning + pReview}% 100%
  )`;

  return (
    <div style={{ position: "relative", width: "120px", height: "120px", borderRadius: "50%", background: gradient, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: "12px", backgroundColor: "var(--hk-bg-secondary)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <span style={{ fontSize: "20px", fontWeight: "bold", color: "var(--hk-text-primary)" }}>{total}</span>
        <span style={{ fontSize: "10px", color: "var(--hk-text-muted)" }}>Total</span>
      </div>
    </div>
  );
}

function ForecastBarChart({ forecast }: { forecast: number[] }) {
  const max = Math.max(...forecast, 10); 
  const days = ["Today", "1d", "2d", "3d", "4d", "5d", "6d"];
  
  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: "120px", gap: "12px", paddingTop: "16px" }}>
      {forecast.map((val, i) => {
        const heightPercent = Math.max((val / max) * 100, 2); 
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: "8px", height: "100%", justifyContent: "flex-end" }}>
            <span style={{ fontSize: "11px", color: val > 0 ? "var(--hk-text-primary)" : "var(--hk-text-muted)" }}>{val}</span>
            <div style={{ 
              width: "100%", 
              height: `${heightPercent}%`, 
              backgroundColor: val > 0 ? (i === 0 ? "var(--hk-accent-primary)" : "var(--hk-accent-secondary)") : "var(--hk-border)", 
              borderRadius: "4px 4px 0 0",
              transition: "height 0.3s ease"
            }} />
            <span style={{ fontSize: "11px", color: "var(--hk-text-muted)", fontWeight: i === 0 ? "bold" : "normal" }}>{days[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
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
        borderRadius: "12px",
        backgroundColor: `${color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "13px", color: "var(--hk-text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </div>
        <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--hk-text)" }}>
          {value}
        </div>
      </div>
    </div>
  );
}
