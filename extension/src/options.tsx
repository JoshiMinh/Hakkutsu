import { useEffect, useState } from "react";
import { SettingsView } from "~components/SettingsView";
import { useSettingsStore } from "~store/settings";
import type { ExtensionSettings } from "~types";
import { DEFAULT_SETTINGS } from "~types";

import "./style.css";

function OptionsPage() {
  const { settings, updateSettings } = useSettingsStore();

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "8px", color: "var(--hk-text)" }}>Hakkutsu Settings</h1>
      <p style={{ color: "var(--hk-text-muted)", marginBottom: "32px" }}>
        Configure your Japanese immersion experience.
      </p>
      
      <div style={{ background: "var(--hk-bg)", padding: "24px", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
        <SettingsView settings={settings} onUpdate={handleUpdateSettings} />
      </div>
    </div>
  );
}

export default OptionsPage;
