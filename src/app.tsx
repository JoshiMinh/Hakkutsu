import React, { Component, useState, useEffect } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Brain, BookOpen, LayoutDashboard, Settings as SettingsIcon, AlertTriangle, RefreshCw } from "lucide-react";
import SrsReview from "~components/srs-review";
import WordList from "~components/word-list";
import StatsOverview from "~components/stats-overview";
import SettingsView from "~components/settings-view";
import { useSettingsStore } from "~lib/utils/settings";
import type { ExtensionSettings } from "~lib/utils/types";
import { useTranslation } from "~lib/locales";
import logoUrl from "data-base64:../assets/icon.png";
import "~style.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("App Tab Error Boundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px 24px", textAlign: "center", color: "#ef4444", background: "var(--hk-bg-secondary)", borderRadius: "12px", border: "1px solid var(--hk-border)", margin: "20px 0" }}>
          <AlertTriangle size={36} style={{ margin: "0 auto 12px", color: "#f59e0b" }} />
          <h3 style={{ fontSize: "17px", fontWeight: "bold", color: "var(--hk-text-primary)", marginBottom: "8px" }}>
            An unexpected error occurred in this view
          </h3>
          <p style={{ fontSize: "13px", color: "var(--hk-text-secondary)", marginBottom: "16px", maxWidth: "500px", margin: "0 auto 16px" }}>
            {this.state.error?.message || "Unknown error"}
          </p>
          <button
            type="button"
            className="hk-btn hk-btn--secondary"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ gap: "8px" }}
          >
            <RefreshCw size={15} /> Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppDashboard() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "review" | "vocabulary" | "settings">(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab") || window.location.hash.replace("#", "");
      if (tabParam && ["dashboard", "review", "vocabulary", "settings"].includes(tabParam)) {
        return tabParam as any;
      }
    } catch {
      // Fallback
    }
    return (localStorage.getItem("hk_active_tab") as any) || "dashboard";
  });

  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();

  useEffect(() => {
    localStorage.setItem("hk_active_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const handleHashOrStateChange = () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get("tab") || window.location.hash.replace("#", "");
        if (tabParam && ["dashboard", "review", "vocabulary", "settings"].includes(tabParam)) {
          setActiveTab(tabParam as any);
        }
      } catch {
        // Ignore
      }
    };
    window.addEventListener("hashchange", handleHashOrStateChange);
    return () => window.removeEventListener("hashchange", handleHashOrStateChange);
  }, []);

  useEffect(() => {
    document.title = `Hakkutsu — ${t(`nav_${activeTab}` as any) || "Learning Hub"}`;
  }, [activeTab, settings?.targetLanguage]);

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  useEffect(() => {
    if (settings?.srsEnabled === false && activeTab === "review") {
      setActiveTab("dashboard");
    }
  }, [settings?.srsEnabled, activeTab]);

  // Keep-alive connection to prevent Chrome from discarding this tab when backgrounded
  useEffect(() => {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.connect) {
        const port = chrome.runtime.connect({ name: "hakkutsu-app-tab" });
        return () => {
          port.disconnect();
        };
      }
    } catch {
      // Ignore
    }
  }, []);

  const srsEnabled = settings?.srsEnabled !== false;

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
            <h1 className="hk-brand-title" style={{ fontSize: "19px", fontWeight: 800, margin: 0, fontFamily: "var(--hk-font-brand)", color: "var(--hk-text-primary)", letterSpacing: "-0.015em" }}>
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
          {srsEnabled && (
            <SidebarButton 
              active={activeTab === "review"} 
              onClick={() => setActiveTab("review")}
              icon={<Brain size={17} />} 
              label={t("nav_review")} 
            />
          )}
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

        <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid var(--hk-border)", padding: "12px 10px 0 10px" }}>
          <strong style={{ fontSize: "13px", fontWeight: 700, color: "var(--hk-text-primary)", display: "block" }}>
            Hakkutsu v0.1.3
          </strong>
          <p style={{ fontSize: "11px", color: "var(--hk-text-muted)", margin: "2px 0 0 0", lineHeight: 1.4 }}>
            Japanese Immersion Extension
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto", backgroundColor: "var(--hk-bg-primary)", display: "flex", flexDirection: "column" }}>
        <ErrorBoundary>
          {activeTab === "review" && (
            <div style={{ maxWidth: "800px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", flex: 1, minHeight: "560px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
                <Brain size={22} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
                <h2 style={{ color: "var(--hk-text-primary)", fontWeight: "bold", fontSize: "20px", margin: 0 }}>
                  {t("srs_title")}
                </h2>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <SrsReview />
              </div>
            </div>
          )}
          {activeTab === "vocabulary" && (
            <div style={{ maxWidth: "1380px", margin: "0 auto", width: "100%" }}>
              <WordList onStartReview={() => setActiveTab("review")} />
            </div>
          )}
          {activeTab === "dashboard" && (
            <div style={{ maxWidth: "1080px", margin: "0 auto", width: "100%" }}>
              <StatsOverview onNavigate={(tab) => setActiveTab(tab)} />
            </div>
          )}
          {activeTab === "settings" && (
            <div style={{ maxWidth: "680px", margin: "0 auto", width: "100%" }}>
              <SettingsView settings={settings} onUpdate={handleUpdateSettings} />
            </div>
          )}
        </ErrorBoundary>
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

export { AppDashboard };

