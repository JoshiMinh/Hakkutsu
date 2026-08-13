import { useState, useEffect } from "react";
import { Brain, BookOpen, LayoutDashboard, Settings as SettingsIcon } from "lucide-react";
import { SrsReview } from "~components/srs-review";
import { WordList } from "~components/word-list";
import { StatsOverview } from "~components/stats-overview";
import { SettingsView } from "~components/settings-view";
import { useSettingsStore } from "~lib/utils/settings";
import { apiClient } from "~lib/services/api-client";
import type { ExtensionSettings } from "~lib/types";
import { DEFAULT_SETTINGS } from "~lib/types";
import "~style.css"; // Ensure styles are loaded
import logoUrl from "url:../assets/icon.png";

export default function AppDashboard() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "review" | "vocabulary" | "settings">(() => {
    return (localStorage.getItem("hk_active_tab") as any) || "dashboard";
  });
  const { settings, updateSettings } = useSettingsStore();

  useEffect(() => {
    localStorage.setItem("hk_active_tab", activeTab);
  }, [activeTab]);

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "var(--hk-bg-primary)", color: "var(--hk-text-primary)" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <img src={logoUrl} alt="Hakkutsu Logo" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <h1 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, fontFamily: "var(--hk-font-jp)", color: "var(--hk-text-primary)" }}>Hakkutsu</h1>
          </div>
          <div style={{ fontSize: "12px", color: "var(--hk-text-muted)", paddingLeft: "36px" }}>Learning & Settings</div>
        </div>
        
        <nav style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SidebarButton 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")}
            icon={<LayoutDashboard size={18} />} label="Dashboard" 
          />
          {settings.srsEnabled && (
            <>
              <SidebarButton 
                active={activeTab === "review"} 
                onClick={() => setActiveTab("review")}
                icon={<Brain size={18} />} label="Reviews" 
              />
              <SidebarButton 
                active={activeTab === "vocabulary"} 
                onClick={() => setActiveTab("vocabulary")}
                icon={<BookOpen size={18} />} label="Vocabulary" 
              />
            </>
          )}
          <SidebarButton 
            active={activeTab === "settings"} 
            onClick={() => setActiveTab("settings")}
            icon={<SettingsIcon size={18} />} label="Settings" 
          />
        </nav>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: "32px", overflowY: "auto", backgroundColor: "var(--hk-bg-primary)" }}>
        {activeTab === "review" && (
          <div style={{ maxWidth: "800px", margin: "0 auto", height: "600px" }}>
            <h2 style={{ marginBottom: "24px", color: "var(--hk-text-primary)", fontWeight: "bold" }}>Study Session</h2>
            <div style={{ height: "500px", border: "1px solid var(--hk-border)", borderRadius: "12px", overflow: "hidden" }}>
              <SrsReview />
            </div>
          </div>
        )}
        {activeTab === "vocabulary" && (
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <WordList />
          </div>
        )}
        {activeTab === "dashboard" && (
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <h2 style={{ marginBottom: "24px", color: "var(--hk-text-primary)", fontWeight: "bold" }}>Overview</h2>
            <StatsOverview />
          </div>
        )}
        {activeTab === "settings" && (
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <h2 style={{ marginBottom: "24px", color: "var(--hk-text-primary)", fontWeight: "bold" }}>App Settings</h2>
            <SettingsView settings={settings} onUpdate={handleUpdateSettings} />
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
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
        backgroundColor: active ? "var(--hk-accent-primary)" : "transparent",
        color: active ? "#fff" : "var(--hk-text-secondary)",
        cursor: "pointer",
        fontSize: "15px",
        fontWeight: active ? "600" : "500",
        textAlign: "left",
        transition: "all 0.2s",
      }}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--hk-bg-hover)";
          e.currentTarget.style.color = "var(--hk-text-primary)";
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--hk-text-secondary)";
        }
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
      {label}
    </button>
  );
}
