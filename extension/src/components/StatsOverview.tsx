import { useState, useEffect } from "react";
import { localSrs } from "~services/local-srs";

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

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>⏳ Loading statistics...</div>;
  if (error) return <div style={{ padding: "40px", color: "var(--hk-accent-crimson)", textAlign: "center" }}>{error}</div>;
  if (!stats) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        
        <StatCard title="Total Words" value={stats.total} icon="📚" color="#8b5cf6" />
        <StatCard title="Mined Sentences" value={stats.mined || 0} icon="⛏️" color="#e85d75" />
        
      </div>

      <h3 style={{ marginTop: "16px", marginBottom: "8px", borderBottom: "1px solid var(--hk-border)", paddingBottom: "8px" }}>
        Retention Breakdown
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <StatCard title="New" value={stats.new || 0} icon="🌱" color="#ef4444" />
        <StatCard title="Learning" value={stats.learning || 0} icon="📖" color="#f59e0b" />
        <StatCard title="Reviewing" value={stats.review || 0} icon="🔄" color="#3b82f6" />
        <StatCard title="Graduated" value={stats.graduated || 0} icon="🎓" color="#10b981" />
      </div>

      {stats.total > 0 && (
        <div style={{ marginTop: "24px", padding: "24px", backgroundColor: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)" }}>
          <h4 style={{ margin: "0 0 16px 0", color: "var(--hk-text-secondary)" }}>Progress Bar</h4>
          <div style={{ height: "24px", width: "100%", display: "flex", borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ width: `${((stats.new || 0) / stats.total) * 100}%`, backgroundColor: "#ef4444" }} title={`New: ${stats.new}`} />
            <div style={{ width: `${((stats.learning || 0) / stats.total) * 100}%`, backgroundColor: "#f59e0b" }} title={`Learning: ${stats.learning}`} />
            <div style={{ width: `${((stats.review || 0) / stats.total) * 100}%`, backgroundColor: "#3b82f6" }} title={`Reviewing: ${stats.review}`} />
            <div style={{ width: `${((stats.graduated || 0) / stats.total) * 100}%`, backgroundColor: "#10b981" }} title={`Graduated: ${stats.graduated}`} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "12px", color: "var(--hk-text-muted)" }}>
            <span style={{ color: "#ef4444" }}>New</span>
            <span style={{ color: "#f59e0b" }}>Learning</span>
            <span style={{ color: "#3b82f6" }}>Review</span>
            <span style={{ color: "#10b981" }}>Graduated</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: string; color: string }) {
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
        borderRadius: "24px",
        backgroundColor: `${color}20`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "24px"
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
