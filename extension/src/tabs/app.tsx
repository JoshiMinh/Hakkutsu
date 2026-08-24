import { useState, useEffect } from "react";
import { Brain, BookOpen, LayoutDashboard, Settings as SettingsIcon } from "lucide-react";
import { SrsReview } from "~components/srs-review";
import { WordList } from "~components/word-list";
import { StatsOverview } from "~components/stats-overview";
import { SettingsView } from "~components/settings-view";
import { useSettingsStore } from "~lib/utils/settings";
import type { ExtensionSettings } from "~lib/types";
import { useTranslation } from "~lib/languages/locales";
import "~style.css";
import logoUrl from "url:~assets/icon.png";

export default function AppDashboard() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "review" | "vocabulary" | "settings">(() => {
    return (localStorage.getItem("hk_active_tab") as any) || "dashboard";
  });
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();

  useEffect(() => {
    localStorage.setItem("hk_active_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    document.title = `Hakkutsu — ${t(`nav_${activeTab}` as any) || "Learning Hub"}`;
  }, [activeTab, settings.targetLanguage]);

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "var(--hk-bg-primary)", color: "var(--hk-text-primary)", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ 
        width: "250px", 
        borderRight: "1px solid var(--hk-border)", 
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--hk-bg-secondary)",
        flexShrink: 0
      }}>
        <div style={{ marginBottom: "28px", padding: "0 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <img src={logoUrl} alt="Hakkutsu Logo" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <h1 style={{ fontSize: "19px", fontWeight: "bold", margin: 0, fontFamily: "var(--hk-font-jp)", color: "var(--hk-text-primary)" }}>
              Hakkutsu
            </h1>
          </div>
          <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", paddingLeft: "38px" }}>
            {t("app_subtitle")}
          </div>
        </div>
        
        <nav style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <SidebarButton 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")}
            icon={<LayoutDashboard size={17} />} 
            label={t("nav_dashboard")} 
          />
          <SidebarButton 
            active={activeTab === "review"} 
            onClick={() => setActiveTab("review")}
            icon={<Brain size={17} />} 
            label={t("nav_review")} 
          />
          <SidebarButton 
            active={activeTab === "vocabulary"} 
            onClick={() => setActiveTab("vocabulary")}
            icon={<BookOpen size={17} />} 
            label={t("nav_vocabulary")} 
          />
          <SidebarButton 
            active={activeTab === "settings"} 
            onClick={() => setActiveTab("settings")}
            icon={<SettingsIcon size={17} />} 
            label={t("nav_settings")} 
          />
        </nav>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto", backgroundColor: "var(--hk-bg-primary)" }}>
        {activeTab === "review" && (
          <div style={{ maxWidth: "800px", margin: "0 auto", minHeight: "560px" }}>
            <h2 style={{ marginBottom: "20px", color: "var(--hk-text-primary)", fontWeight: "bold", fontSize: "20px" }}>
              {t("srs_title")}
            </h2>
            <div style={{ border: "1px solid var(--hk-border)", borderRadius: "12px", overflow: "hidden", background: "var(--hk-bg-secondary)" }}>
              <SrsReview />
            </div>
          </div>
        )}
        {activeTab === "vocabulary" && (
          <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
            <WordList />
          </div>
        )}
        {activeTab === "dashboard" && (
          <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
            <StatsOverview onNavigate={(tab) => setActiveTab(tab)} />
          </div>
        )}
        {activeTab === "settings" && (
          <div style={{ maxWidth: "680px", margin: "0 auto" }}>
            <SettingsView settings={settings} onUpdate={handleUpdateSettings} />
          </div>
        )}
      </main>
    </div>
  );
}

function SidebarButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string; 
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 14px",
        borderRadius: "8px",
        border: "none",
        background: active ? "rgba(168, 85, 247, 0.16)" : "transparent",
        color: active ? "#ffffff" : "var(--hk-text-secondary)",
        fontSize: "13px",
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "all 0.15s ease",
        boxShadow: active ? "inset 0 0 0 1px rgba(168, 85, 247, 0.35)" : "none"
      }}
    >
      <span style={{ color: active ? "var(--hk-accent-primary)" : "inherit" }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
