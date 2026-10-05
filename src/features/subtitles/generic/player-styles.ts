export const genericPlayerCss = `
  /* ── Generic Player Draggable Button ──────────────────────────── */
  .hk-generic-fab {
    position: fixed !important;
    z-index: 2147483646 !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 6px 12px 6px 9px !important;
    border-radius: 20px !important;
    background: rgba(13, 13, 17, 0.92) !important;
    backdrop-filter: blur(14px) !important;
    -webkit-backdrop-filter: blur(14px) !important;
    border: 1px solid rgba(255, 255, 255, 0.14) !important;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.06) !important;
    cursor: pointer !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    color: rgba(255, 255, 255, 0.75) !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    transition: box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease !important;
    touch-action: none !important;
    pointer-events: auto !important;
  }

  .hk-generic-fab:hover {
    border-color: rgba(192, 132, 252, 0.4) !important;
    box-shadow: 0 8px 28px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.2) !important;
    color: #fff !important;
  }

  .hk-generic-fab.is-active {
    border-color: rgba(168, 85, 247, 0.45) !important;
    box-shadow: 0 8px 28px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.25), 0 0 16px rgba(168,85,247,0.18) !important;
    color: #fff !important;
  }

  .hk-generic-fab.is-off {
    opacity: 0.75 !important;
  }

  .hk-generic-fab.is-dragging {
    opacity: 0.9 !important;
    cursor: grabbing !important;
    transition: none !important;
    box-shadow: 0 16px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(168,85,247,0.3) !important;
    border-color: rgba(192, 132, 252, 0.5) !important;
  }

  .hk-generic-fab__kanji {
    font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif !important;
    font-size: 15px !important;
    font-weight: 900 !important;
    line-height: 1 !important;
    letter-spacing: -0.5px !important;
    pointer-events: none !important;
  }

  .hk-generic-fab.is-active .hk-generic-fab__kanji {
    color: #c084fc !important;
    text-shadow: 0 0 10px rgba(192, 132, 252, 0.7) !important;
  }

  .hk-generic-fab.is-off .hk-generic-fab__kanji {
    color: rgba(255, 255, 255, 0.6) !important;
  }

  .hk-generic-fab__label {
    pointer-events: none !important;
    white-space: nowrap !important;
    font-size: 11px !important;
    letter-spacing: 0.02em !important;
  }

  .hk-generic-fab__dot {
    width: 6px !important;
    height: 6px !important;
    border-radius: 50% !important;
    flex-shrink: 0 !important;
    pointer-events: none !important;
    transition: background 0.2s ease !important;
  }

  .hk-generic-fab.is-active .hk-generic-fab__dot {
    background: #a855f7 !important;
    box-shadow: 0 0 6px rgba(168,85,247,0.8) !important;
  }

  .hk-generic-fab.is-off .hk-generic-fab__dot {
    background: rgba(255, 255, 255, 0.25) !important;
    box-shadow: none !important;
  }

  /* ── Synchronized Subtitle Script Drawer ("Reader Mode") ── */
  .hk-script-drawer {
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    height: 100% !important;
    background: rgba(13, 13, 17, 0.95) !important;
    backdrop-filter: blur(24px) !important;
    -webkit-backdrop-filter: blur(24px) !important;
    border-left: 1px solid rgba(255, 255, 255, 0.12) !important;
    box-shadow: -12px 0 36px rgba(0, 0, 0, 0.75) !important;
    display: flex !important;
    flex-direction: column !important;
    z-index: 10001 !important;
    pointer-events: auto !important;
    animation: hk-script-slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
    user-select: text !important;
    -webkit-user-select: text !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic Pro", "Yu Gothic", sans-serif !important;
    color: #f4f4f5 !important;
    box-sizing: border-box !important;
  }

  @keyframes hk-script-slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .hk-script-drawer__header {
    padding: 12px 14px 10px !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    background: rgba(18, 18, 24, 0.75) !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    flex-shrink: 0 !important;
    box-sizing: border-box !important;
  }

  .hk-script-drawer__title-row {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
  }

  .hk-script-drawer__title-group {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .hk-script-drawer__title {
    font-size: 14px !important;
    font-weight: 700 !important;
    color: #f4f4f5 !important;
    letter-spacing: -0.01em !important;
  }

  .hk-script-drawer__badge {
    font-size: 11px !important;
    font-weight: 600 !important;
    padding: 2px 7px !important;
    background: rgba(168, 85, 247, 0.16) !important;
    border: 1px solid rgba(168, 85, 247, 0.35) !important;
    color: #d8b4fe !important;
    border-radius: 9999px !important;
  }

  .hk-script-drawer__actions {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .hk-script-btn-icon {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 28px !important;
    height: 28px !important;
    background: transparent !important;
    border: 1px solid transparent !important;
    border-radius: 6px !important;
    color: #a1a1aa !important;
    cursor: pointer !important;
    padding: 0 !important;
    transition: all 0.15s ease !important;
  }

  .hk-script-btn-icon:hover {
    background: rgba(255, 255, 255, 0.08) !important;
    color: #f4f4f5 !important;
    border-color: rgba(255, 255, 255, 0.1) !important;
  }

  .hk-script-btn-icon--active {
    background: rgba(168, 85, 247, 0.2) !important;
    color: #c084fc !important;
    border-color: rgba(168, 85, 247, 0.4) !important;
  }

  .hk-script-btn-icon--close:hover {
    background: rgba(239, 68, 68, 0.18) !important;
    color: #f87171 !important;
    border-color: rgba(239, 68, 68, 0.3) !important;
  }

  .hk-script-drawer__search-row {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
  }

  .hk-script-search-input-wrapper {
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    flex: 1 !important;
    background: rgba(0, 0, 0, 0.45) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
    padding: 0 8px 0 28px !important;
    height: 32px !important;
    transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
    box-sizing: border-box !important;
  }

  .hk-script-search-input-wrapper:focus-within {
    border-color: rgba(168, 85, 247, 0.6) !important;
    box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2) !important;
  }

  .hk-script-search-icon {
    position: absolute !important;
    left: 8px !important;
    color: #71717a !important;
    pointer-events: none !important;
  }

  .hk-script-search-input {
    width: 100% !important;
    background: transparent !important;
    border: none !important;
    outline: none !important;
    color: #f4f4f5 !important;
    font-size: 12px !important;
    font-family: inherit !important;
    padding: 0 !important;
  }

  .hk-script-search-input::placeholder {
    color: #71717a !important;
  }

  .hk-script-search-clear {
    background: transparent !important;
    border: none !important;
    color: #71717a !important;
    cursor: pointer !important;
    padding: 2px !important;
    display: inline-flex !important;
  }

  .hk-script-search-clear:hover {
    color: #f4f4f5 !important;
  }

  .hk-script-search-nav {
    display: flex !important;
    align-items: center !important;
    gap: 2px !important;
    background: rgba(0, 0, 0, 0.45) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 6px !important;
    padding: 2px 4px !important;
    height: 32px !important;
    box-sizing: border-box !important;
  }

  .hk-script-search-count {
    font-size: 11px !important;
    font-weight: 600 !important;
    color: #a1a1aa !important;
    padding: 0 4px !important;
    white-space: nowrap !important;
  }

  .hk-script-search-nav-btn {
    background: transparent !important;
    border: none !important;
    color: #a1a1aa !important;
    cursor: pointer !important;
    padding: 2px !important;
    border-radius: 4px !important;
    display: inline-flex !important;
  }

  .hk-script-search-nav-btn:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #f4f4f5 !important;
  }

  .hk-script-drawer__control-row {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 6px !important;
  }

  .hk-script-filter-group {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .hk-script-filter-chip {
    font-size: 11px !important;
    font-weight: 600 !important;
    padding: 3px 8px !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 6px !important;
    color: #a1a1aa !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
  }

  .hk-script-filter-chip:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #f4f4f5 !important;
  }

  .hk-script-filter-chip--active {
    background: rgba(168, 85, 247, 0.22) !important;
    border-color: rgba(168, 85, 247, 0.45) !important;
    color: #d8b4fe !important;
  }

  .hk-script-quick-toggles {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .hk-script-toggle-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 3px 6px !important;
    height: 24px !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 5px !important;
    color: #71717a !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
  }

  .hk-script-toggle-btn:hover {
    color: #f4f4f5 !important;
    background: rgba(255, 255, 255, 0.1) !important;
  }

  .hk-script-toggle-btn--active {
    background: rgba(168, 85, 247, 0.2) !important;
    border-color: rgba(168, 85, 247, 0.4) !important;
    color: #c084fc !important;
  }

  /* ── Script Analytics Box ── */
  .hk-script-analytics-box {
    background: rgba(0, 0, 0, 0.35) !important;
    border: 1px solid rgba(255, 255, 255, 0.07) !important;
    border-radius: 8px !important;
    padding: 8px 10px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 6px !important;
    animation: hk-sub-fade-in 0.15s ease-out !important;
    box-sizing: border-box !important;
  }

  .hk-script-analytics-stats {
    display: flex !important;
    align-items: center !important;
    justify-content: space-around !important;
  }

  .hk-script-stat-item {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    gap: 1px !important;
  }

  .hk-script-stat-val {
    font-size: 13px !important;
    font-weight: 700 !important;
    color: #f4f4f5 !important;
  }

  .hk-script-stat-lbl {
    font-size: 10px !important;
    color: #71717a !important;
    text-transform: uppercase !important;
    letter-spacing: 0.03em !important;
  }

  .hk-script-jlpt-bar {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px !important;
    flex-wrap: wrap !important;
  }

  .hk-script-jlpt-pill {
    font-size: 9px !important;
    font-weight: 700 !important;
    padding: 1px 5px !important;
    border-radius: 4px !important;
    letter-spacing: 0.02em !important;
  }

  .hk-jlpt-pill--n5 { background: rgba(59, 130, 246, 0.2) !important; color: #60a5fa !important; border: 1px solid rgba(59, 130, 246, 0.3) !important; }
  .hk-jlpt-pill--n4 { background: rgba(16, 185, 129, 0.2) !important; color: #34d399 !important; border: 1px solid rgba(16, 185, 129, 0.3) !important; }
  .hk-jlpt-pill--n3 { background: rgba(245, 158, 11, 0.2) !important; color: #fbbf24 !important; border: 1px solid rgba(245, 158, 11, 0.3) !important; }
  .hk-jlpt-pill--n2 { background: rgba(239, 68, 68, 0.2) !important; color: #f87171 !important; border: 1px solid rgba(239, 68, 68, 0.3) !important; }
  .hk-jlpt-pill--n1 { background: rgba(168, 85, 247, 0.2) !important; color: #c084fc !important; border: 1px solid rgba(168, 85, 247, 0.3) !important; }

  /* ── Subtitle Cues Scroll List ── */
  .hk-script-drawer__list {
    flex: 1 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    padding: 8px 10px 48px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 6px !important;
    scroll-behavior: smooth !important;
    box-sizing: border-box !important;
  }

  .hk-script-drawer__empty {
    padding: 32px 16px !important;
    text-align: center !important;
    font-size: 13px !important;
    color: #71717a !important;
  }

  .hk-script-cue {
    position: relative !important;
    padding: 8px 10px !important;
    background: rgba(255, 255, 255, 0.03) !important;
    border: 1px solid rgba(255, 255, 255, 0.06) !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
    box-sizing: border-box !important;
  }

  .hk-script-cue:hover {
    background: rgba(255, 255, 255, 0.07) !important;
    border-color: rgba(255, 255, 255, 0.14) !important;
  }

  .hk-script-cue--active {
    background: rgba(168, 85, 247, 0.14) !important;
    border-color: rgba(168, 85, 247, 0.5) !important;
    box-shadow: 0 0 16px rgba(168, 85, 247, 0.2) !important;
    border-left: 3px solid #a855f7 !important;
  }

  .hk-script-cue--matched {
    border-color: rgba(251, 191, 36, 0.4) !important;
    background: rgba(251, 191, 36, 0.08) !important;
  }

  .hk-script-cue--current-match {
    border-color: rgba(251, 191, 36, 0.8) !important;
    background: rgba(251, 191, 36, 0.15) !important;
  }

  .hk-script-cue__meta {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
  }

  .hk-script-cue__time {
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    color: #a1a1aa !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
  }

  .hk-script-cue--active .hk-script-cue__time {
    color: #d8b4fe !important;
    font-weight: 700 !important;
  }

  .hk-script-cue__play-icon {
    opacity: 0.6 !important;
    transition: transform 0.15s ease !important;
  }

  .hk-script-cue:hover .hk-script-cue__play-icon {
    opacity: 1 !important;
    transform: scale(1.15) !important;
    color: #c084fc !important;
  }

  .hk-script-cue__actions {
    display: flex !important;
    align-items: center !important;
    gap: 2px !important;
    opacity: 0.4 !important;
    transition: opacity 0.15s ease !important;
  }

  .hk-script-cue:hover .hk-script-cue__actions,
  .hk-script-cue--active .hk-script-cue__actions,
  .hk-script-cue:focus-within .hk-script-cue__actions {
    opacity: 1 !important;
  }

  @media (hover: none) {
    .hk-script-cue__actions { opacity: 1 !important; }
  }

  .hk-script-action-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 22px !important;
    height: 22px !important;
    background: transparent !important;
    border: none !important;
    border-radius: 4px !important;
    color: #a1a1aa !important;
    cursor: pointer !important;
    padding: 0 !important;
    transition: all 0.15s ease !important;
  }

  .hk-script-action-btn:hover {
    background: rgba(255, 255, 255, 0.12) !important;
    color: #f4f4f5 !important;
  }

  .hk-script-action-btn--mined {
    color: #4ade80 !important;
  }

  .hk-script-action-btn--active {
    color: #c084fc !important;
    animation: hk-pulse 1s infinite !important;
  }

  /* ── Japanese Dialogue & Tokens ── */
  .hk-script-cue__primary {
    font-size: 14px !important;
    line-height: 1.6 !important;
    color: #f4f4f5 !important;
    display: inline !important;
    word-break: break-word !important;
  }

  .hk-script-cue--active .hk-script-cue__primary {
    color: #ffffff !important;
    font-weight: 500 !important;
  }

  .hk-script-token {
    position: relative !important;
    display: inline-block !important;
    padding: 0 1px !important;
    border-radius: 3px !important;
    cursor: pointer !important;
    transition: background 0.12s ease, color 0.12s ease !important;
    line-height: 1.5 !important;
  }

  .hk-script-token:hover {
    background: rgba(168, 85, 247, 0.3) !important;
    color: #fff !important;
    box-shadow: 0 0 4px rgba(168, 85, 247, 0.4) !important;
  }

  .hk-script-token:focus-visible {
    outline: 2px solid #c084fc !important;
    outline-offset: 2px !important;
  }

  .hk-script-token--known {
    border-bottom: 1.5px solid rgba(74, 222, 128, 0.65) !important;
  }

  .hk-script-token--new {
    background: rgba(251, 191, 36, 0.08) !important;
    text-decoration: underline dotted rgba(251, 191, 36, 0.8) !important;
    text-underline-offset: 3px !important;
  }

  .hk-script-token--plain {
    cursor: text !important;
  }

  .hk-script-known-dot {
    position: absolute !important;
    top: 2px !important;
    right: -2px !important;
    width: 4px !important;
    height: 4px !important;
    background: #4ade80 !important;
    border-radius: 50% !important;
    box-shadow: 0 0 4px rgba(74, 222, 128, 0.8) !important;
    pointer-events: none !important;
  }

  .hk-script-token--jlpt-n5 { border-bottom: 1px dashed rgba(96, 165, 250, 0.5) !important; }
  .hk-script-token--jlpt-n4 { border-bottom: 1px dashed rgba(52, 211, 153, 0.5) !important; }
  .hk-script-token--jlpt-n3 { border-bottom: 1px dashed rgba(251, 191, 36, 0.5) !important; }
  .hk-script-token--jlpt-n2 { border-bottom: 1px dashed rgba(248, 113, 113, 0.5) !important; }
  .hk-script-token--jlpt-n1 { border-bottom: 1px dashed rgba(192, 132, 252, 0.5) !important; }

  .hk-script-rt {
    font-size: 0.62em !important;
    line-height: 1 !important;
    color: #c084fc !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }

  .hk-script-mark {
    background: rgba(251, 191, 36, 0.35) !important;
    color: #fef08a !important;
    padding: 0 2px !important;
    border-radius: 2px !important;
  }

  /* ── Secondary Translation Bar ── */
  .hk-script-cue__secondary {
    font-size: 11.5px !important;
    line-height: 1.4 !important;
    color: #a1a1aa !important;
    font-weight: 400 !important;
    border-top: 1px dashed rgba(255, 255, 255, 0.06) !important;
    padding-top: 3px !important;
    margin-top: 2px !important;
  }

  .hk-script-cue--active .hk-script-cue__secondary {
    color: #e4e4e7 !important;
  }

  /* ── Floating "Resume Auto-Scroll" Pill ── */
  .hk-script-resume-pill {
    position: absolute !important;
    bottom: 12px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 6px 14px !important;
    background: rgba(17, 17, 24, 0.92) !important;
    backdrop-filter: blur(12px) !important;
    border: 1px solid rgba(168, 85, 247, 0.5) !important;
    border-radius: 9999px !important;
    color: #f4f4f5 !important;
    font-size: 11.5px !important;
    font-weight: 600 !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6) !important;
    cursor: pointer !important;
    z-index: 10 !important;
    transition: all 0.15s ease !important;
    animation: hk-sub-fade-in 0.15s ease-out !important;
  }

  .hk-script-resume-pill:hover {
    background: rgba(168, 85, 247, 0.9) !important;
    color: #ffffff !important;
    transform: translateX(-50%) translateY(-2px) !important;
    box-shadow: 0 10px 28px rgba(168, 85, 247, 0.4) !important;
  }

  .hk-script-resume-pill__time {
    padding: 1px 6px !important;
    background: rgba(0, 0, 0, 0.3) !important;
    border-radius: 4px !important;
    font-family: monospace !important;
    font-size: 10px !important;
  }
`;
