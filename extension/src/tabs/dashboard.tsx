import { useState, useEffect } from "react";
import { SrsReview } from "~components/SrsReview";
import { WordList } from "~components/WordList";
import { StatsOverview } from "~components/StatsOverview";
import { getSettings } from "~services/storage";
import { apiClient } from "~services/api-client";
import "~style.css"; // Ensure styles are loaded

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"review" | "vocabulary" | "stats">("review");

  useEffect(() => {
    // Initialize API client from settings on mount
    getSettings().then((settings) => {
      apiClient.setBaseUrl(settings.backendUrl);
    });
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "var(--hk-bg)", color: "var(--hk-text)" }}>
      {/* Sidebar */}
      <div style={{ 
        width: "250px", 
        borderRight: "1px solid var(--hk-border)", 
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--hk-bg-secondary)"
      }}>
        <div style={{ marginBottom: "32px", padding: "0 12px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, fontFamily: "var(--hk-font-jp)" }}>発掘 Hakkutsu</h1>
          <div style={{ fontSize: "12px", color: "var(--hk-text-muted)" }}>Learning Dashboard</div>
        </div>
        
        <nav style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SidebarButton 
            active={activeTab === "review"} 
            onClick={() => setActiveTab("review")}
            icon="🧠" label="Review" 
          />
          <SidebarButton 
            active={activeTab === "vocabulary"} 
            onClick={() => setActiveTab("vocabulary")}
            icon="📚" label="Vocabulary" 
          />
          <SidebarButton 
            active={activeTab === "stats"} 
            onClick={() => setActiveTab("stats")}
            icon="📊" label="Stats" 
          />
        </nav>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: "32px", overflowY: "auto" }}>
        {activeTab === "review" && (
          <div style={{ maxWidth: "800px", margin: "0 auto", height: "600px" }}>
            <h2 style={{ marginBottom: "24px" }}>Study Session</h2>
            <div style={{ height: "500px", border: "1px solid var(--hk-border)", borderRadius: "12px", overflow: "hidden" }}>
              <SrsReview />
            </div>
          </div>
        )}
        {activeTab === "vocabulary" && (
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <h2 style={{ marginBottom: "24px" }}>Your Vocabulary</h2>
            <WordList />
          </div>
        )}
        {activeTab === "stats" && (
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <h2 style={{ marginBottom: "24px" }}>Learning Statistics</h2>
            <StatsOverview />
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: string, label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "var(--hk-accent-crimson)" : "transparent",
        color: active ? "#fff" : "var(--hk-text-secondary)",
        cursor: "pointer",
        fontSize: "15px",
        fontWeight: active ? "600" : "500",
        textAlign: "left",
        transition: "all 0.2s",
      }}
      onMouseOver={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "rgba(232, 93, 117, 0.1)";
      }}
      onMouseOut={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span style={{ fontSize: "18px" }}>{icon}</span>
      {label}
    </button>
  );
}
