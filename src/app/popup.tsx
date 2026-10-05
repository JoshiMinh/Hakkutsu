import {
  LoadingSpinner,
  TranslateQuickView,
} from "~/features/dictionary/quick-lookup";
/**
 * Hakkutsu Popup — Main Extension Interface
 *
 * Single-view design combining Japanese text analysis, translation, and SRS reviews.
 */

import { useEffect, useState, Suspense, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import {
  Brain,
  Languages,
  ExternalLink,
  Settings,
  PanelRight,
} from "lucide-react";

import { useSettingsStore } from "~/features/settings/settings-store";

import { useTranslation } from "~/shared/locales";

import type { ExtensionView } from "~/app/types";

import "~/styles/global.css";
import SrsReview from "~/features/srs/srs-review";

const appLogo = "/assets/icon.png";
const kofiSvg = "/assets/logo/kofi.png";

interface PopupErrorBoundaryProps {
  children: ReactNode;
}

interface PopupErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  PopupErrorBoundaryProps,
  PopupErrorBoundaryState
> {
  constructor(props: PopupErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PopupErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Popup Error Boundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "24px 16px",
            textAlign: "center",
            color: "#ef4444",
          }}
        >
          <div
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              marginBottom: "8px",
            }}
          >
            View Error
          </div>
          <p
            style={{ fontSize: "12px", color: "#a1a1aa", marginBottom: "12px" }}
          >
            {this.state.error?.message || "An error occurred"}
          </p>
          <button
            type="button"
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Popup ──────────────────────────────────────────────────────

function Popup() {
  const [activeView, setActiveView] = useState<ExtensionView>("translate");
  const { settings } = useSettingsStore();
  const { t } = useTranslation();
  useEffect(() => {
    if (settings.srsEnabled === false && activeView === "srs") {
      setActiveView("translate");
    }
  }, [settings.srsEnabled, activeView]);

  const tabs: Array<{
    id: ExtensionView;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "translate",
      label: t("popup_tab_translate"),
      icon: <Languages size={15} />,
    },
    ...(settings.srsEnabled !== false
      ? [
          {
            id: "srs" as ExtensionView,
            label: t("popup_tab_review"),
            icon: <Brain size={15} />,
          },
        ]
      : []),
  ];

  const handleOpenAppTab = () => {
    const appUrl = chrome.runtime.getURL("options.html");
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ url: appUrl }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId) {
            chrome.windows.update(tabs[0].windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: appUrl });
        }
      });
    } else {
      window.open(appUrl, "_blank");
    }
  };

  const handleOpenTranscript = () => {
    const opened = browser.sidebarAction?.open
      ? browser.sidebarAction.open()
      : chrome.windows
          .getCurrent()
          .then((current) => chrome.sidePanel.open({ windowId: current.id! }));
    void opened
      .then(() => window.close())
      .catch((error) => window.alert(error.message));
  };

  return (
    <div className="hk-popup">
      <header className="hk-popup-header">
        <div className="hk-popup-brand">
          <img src={appLogo} alt="" width={28} height={28} />
          <div>
            <div className="hk-brand-title">Hakkutsu</div>
            <div className="hk-popup-brand__subtitle">
              {t("popup_subtitle")}
            </div>
          </div>
        </div>
        <div className="hk-popup-header__actions">
          <button
            type="button"
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={handleOpenAppTab}
          >
            {t("popup_btn_app")} <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className="hk-popup-icon"
            onClick={handleOpenTranscript}
            aria-label={t("drawer_title")}
            title={t("drawer_title")}
          >
            <PanelRight size={17} />
          </button>
          <button
            type="button"
            className="hk-popup-icon"
            onClick={() =>
              chrome.tabs.create({
                url: chrome.runtime.getURL("options.html?tab=settings"),
              })
            }
            aria-label={t("nav_settings")}
            title={t("nav_settings")}
          >
            <Settings size={17} />
          </button>
          <a
            className="hk-popup-icon"
            href="https://ko-fi.com/joshiminh"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Support on Ko-fi"
            title="Support on Ko-fi"
          >
            <img src={kofiSvg} alt="" width={18} height={18} />
          </a>
        </div>
      </header>

      {/* Segmented Pill Tabs — rendered only when multiple views are active */}
      {tabs.length > 1 && (
        <nav
          className="hk-nav hk-popup-nav"
          role="tablist"
          aria-label="Popup views"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`hk-nav__tab ${activeView === tab.id ? "hk-nav__tab--active" : ""}`}
              onClick={() => setActiveView(tab.id)}
              role="tab"
              id={`popup-tab-${tab.id}`}
              aria-controls="popup-panel"
              tabIndex={activeView === tab.id ? 0 : -1}
              onKeyDown={(event) => {
                const index = tabs.findIndex((item) => item.id === activeView);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setActiveView(tabs[next].id);
                document.getElementById(`popup-tab-${tabs[next].id}`)?.focus();
              }}
              aria-selected={activeView === tab.id}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div
        id="popup-panel"
        className="hk-popup-panel"
        role="tabpanel"
        aria-labelledby={
          tabs.length > 1 ? `popup-tab-${activeView}` : undefined
        }
        aria-label={tabs.length === 1 ? tabs[0].label : undefined}
      >
        <ErrorBoundary>
          <Suspense fallback={<LoadingSpinner text="Loading view..." />}>
            {activeView === "translate" && <TranslateQuickView />}
            {activeView === "srs" && <SrsReview compact />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default Popup;
