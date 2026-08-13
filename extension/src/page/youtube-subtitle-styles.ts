/**
 * CSS styles for the YouTube subtitle overlay.
 *
 * Returns a CSS string to be injected via Plasmo's getStyle().
 * Uses the Hakkutsu design tokens (--hk-*) for consistency.
 */

export const youtubeSubtitleCss = /* css */ `
  :host {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    display: block !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }

  #plasmo-shadow-container {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    pointer-events: none !important;
  }

  .plasmo-csui-container {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    display: block !important;
    pointer-events: none !important;
  }

  /* ── Hide native YouTube captions when Hakkutsu is active ── */
  .hk-subs-active .ytp-caption-segment,
  .hk-subs-active .caption-window,
  .hk-subs-active .captions-text {
    display: none !important;
  }

  /* ── Subtitle Container ──────────────────────────────────── */
  .hk-sub__container {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    z-index: 9999;
    width: 88%;
    max-width: 900px;
    pointer-events: auto;
    transition: opacity 0.25s ease, transform 0.25s ease;
  }

  .hk-sub__container--hidden {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
    pointer-events: none;
  }

  /* ── Subtitle Bar ──────────────────────────────────────────── */
  .hk-sub__bar {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 1px;
    background: rgba(9, 9, 11, 0.82);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 10px 24px 14px;
    border-radius: 14px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    cursor: text;
    line-height: 1.8;
    font-size: 26px;
    font-family: 'Noto Sans JP', 'Yu Gothic', sans-serif;
    color: #f4f4f5;
    user-select: text;
    -webkit-user-select: text;
    transition: background 0.2s ease;
    animation: hk-sub-fade-in 0.2s ease-out;
  }

  .hk-sub__bar:hover {
    background: rgba(9, 9, 11, 0.95);
    border-color: rgba(255, 255, 255, 0.1);
  }

  /* ── Individual Token ────────────────────────────────────── */
  .hk-sub__token {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 0 1px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .hk-sub__token:hover {
    background: rgba(168, 85, 247, 0.15);
    transform: scale(1.03);
  }

  .hk-sub__token:active {
    background: rgba(168, 85, 247, 0.25);
  }

  .hk-sub__token--particle {
    color: rgba(244, 244, 245, 0.5);
  }

  .hk-sub__token--particle:hover {
    color: rgba(244, 244, 245, 0.85);
  }

  /* JLPT level color coding */
  .hk-sub__token--n5 { color: #4ade80; }
  .hk-sub__token--n4 { color: #60a5fa; }
  .hk-sub__token--n3 { color: #fbbf24; }
  .hk-sub__token--n2 { color: #f87171; }
  .hk-sub__token--n1 { color: #c084fc; }

  /* ── Furigana (Ruby) ─────────────────────────────────────── */
  .hk-sub__furigana {
    font-size: 0.42em;
    line-height: 1;
    opacity: 0.7;
    margin-bottom: -2px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: inherit;
    pointer-events: none;
  }

  .hk-sub__furigana--hidden {
    opacity: 0;
  }

  .hk-sub__surface {
    white-space: nowrap;
  }

  /* ── Overlay Wrapper & Action Bar ────────────────────────── */
  .hk-sub__overlay-wrapper {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
  }

  .hk-sub__brand {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 6px;
    padding: 2px 10px;
    border-radius: 999px;
    background: rgba(9, 9, 11, 0.75);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.45);
    font: 600 9px/1.4 'Inter', 'Segoe UI', sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .hk-sub__overlay-wrapper:hover .hk-sub__brand {
    opacity: 0.3;
  }

  .hk-sub__overlay-wrapper:hover .hk-sub__action-bar {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }

  .hk-sub__action-bar {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(6px);
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
    background: rgba(9, 9, 11, 0.92);
    backdrop-filter: blur(16px);
    padding: 4px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    opacity: 0;
    pointer-events: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    z-index: 10;
  }

  .hk-sub__action-btn {
    background: transparent;
    border: 1px solid transparent;
    color: rgba(244, 244, 245, 0.6);
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.15s ease;
  }

  .hk-sub__action-btn:hover {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.25);
    color: #c084fc;
    transform: translateY(-1px);
  }

  .hk-sub__action-btn:active {
    transform: translateY(0);
    background: rgba(168, 85, 247, 0.25);
  }

  .hk-sub__action-btn--sentence {
    width: auto;
    min-width: 100px;
    padding: 0 10px;
    color: rgba(244, 244, 245, 0.8);
    font-size: 11px;
    font-weight: 600;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    white-space: nowrap;
    gap: 4px;
    border-radius: 6px;
  }

  .hk-sub__action-btn--sentence:hover {
    color: #e9d5ff;
    background: rgba(168, 85, 247, 0.2);
    border-color: rgba(168, 85, 247, 0.3);
  }

  /* ── Transcript Panel ────────────────────────────────────── */
  .hk-sub__transcript {
    position: absolute;
    top: 0;
    right: -280px;
    width: 260px;
    height: 100%;
    background: rgba(9, 9, 11, 0.92);
    backdrop-filter: blur(16px);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    overflow-y: auto;
    z-index: 9998;
    padding: 12px 8px;
    pointer-events: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .hk-sub__transcript::-webkit-scrollbar {
    width: 4px;
  }

    line-height: 1.8;
    font-size: 26px;
    font-family: 'Noto Sans JP', 'Yu Gothic', sans-serif;
    color: #f4f4f5;
    user-select: text;
    -webkit-user-select: text;
    transition: background 0.2s ease;
    animation: hk-sub-fade-in 0.2s ease-out;
  }

  .hk-sub__bar:hover {
    background: rgba(9, 9, 11, 0.95);
    border-color: rgba(255, 255, 255, 0.1);
  }

  /* ── Individual Token ────────────────────────────────────── */
  .hk-sub__token {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 0 1px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .hk-sub__token:hover {
    background: rgba(168, 85, 247, 0.15);
    transform: scale(1.03);
  }

  .hk-sub__token:active {
    background: rgba(168, 85, 247, 0.25);
  }

  .hk-sub__token--particle {
    color: rgba(244, 244, 245, 0.5);
  }

  .hk-sub__token--particle:hover {
    color: rgba(244, 244, 245, 0.85);
  }

  /* JLPT level color coding */
  .hk-sub__token--n5 { color: #4ade80; }
  .hk-sub__token--n4 { color: #60a5fa; }
  .hk-sub__token--n3 { color: #fbbf24; }
  .hk-sub__token--n2 { color: #f87171; }
  .hk-sub__token--n1 { color: #c084fc; }

  /* ── Furigana (Ruby) ─────────────────────────────────────── */
  .hk-sub__furigana {
    font-size: 0.42em;
    line-height: 1;
    opacity: 0.7;
    margin-bottom: -2px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: inherit;
    pointer-events: none;
  }

  .hk-sub__furigana--hidden {
    opacity: 0;
  }

  .hk-sub__surface {
    white-space: nowrap;
  }

  /* ── Overlay Wrapper & Action Bar ────────────────────────── */
  .hk-sub__overlay-wrapper:hover .hk-sub__action-bar,
  .hk-sub__action-bar:hover {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }

  .hk-sub__action-bar {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    display: flex;
    gap: 6px;
    background: rgba(9, 9, 11, 0.95);
    backdrop-filter: blur(16px);
    padding: 4px 6px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    opacity: 0;
    pointer-events: none;
    transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    z-index: 99999;
  }

  .hk-sub__action-bar::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    height: 16px;
  }

  .hk-sub__action-btn {
    background: transparent;
    border: 1px solid transparent;
    color: rgba(244, 244, 245, 0.7);
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.15s ease;
  }

  .hk-sub__action-btn:hover {
    background: rgba(168, 85, 247, 0.2);
    border-color: rgba(168, 85, 247, 0.35);
    color: #c084fc;
    transform: translateY(-1px);
  }

  .hk-sub__action-btn--sentence {
    width: auto !important;
    padding: 0 12px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    background: rgba(147, 51, 234, 0.25) !important;
    border-color: rgba(168, 85, 247, 0.45) !important;
    color: #e9d5ff !important;
    display: inline-flex !important;
    align-items: center !important;
  }

  .hk-sub__action-btn--sentence:hover {
    background: #9333ea !important;
    border-color: #a855f7 !important;
    color: #ffffff !important;
  }

  .hk-sub__action-btn:active {
    transform: translateY(0);
  }

  /* ── Transcript Panel ────────────────────────────────────── */
  .hk-sub__transcript {
    position: absolute;
    top: 0;
    right: -280px;
    width: 260px;
    height: 100%;
    background: rgba(9, 9, 11, 0.92);
    backdrop-filter: blur(16px);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    overflow-y: auto;
    z-index: 9998;
    padding: 12px 8px;
    pointer-events: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .hk-sub__transcript::-webkit-scrollbar {
    width: 4px;
  }

  .hk-sub__transcript::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }

  .hk-sub__transcript-item {
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    transition: background 0.15s ease, color 0.15s ease;
    line-height: 1.5;
    font-family: 'Noto Sans JP', sans-serif;
    border-left: 2px solid transparent;
  }

  .hk-sub__transcript-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.85);
  }

  .hk-sub__transcript-item--active {
    background: rgba(168, 85, 247, 0.08);
    color: #c084fc;
    border-left-color: #a855f7;
  }

  .hk-sub__transcript-time {
    font-size: 10px;
    opacity: 0.5;
    white-space: nowrap;
    padding-top: 2px;
    font-family: 'Inter', 'JetBrains Mono', monospace;
    min-width: 36px;
  }

  .hk-sub__transcript-text {
    flex: 1;
  }

  /* ── Fade animation ─────────────────────────────────────── */
  @keyframes hk-sub-fade-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

export const youtubeToolbarCss = `
  #hk-toolbar-portal,
  #hk-toolbar-portal.ytp-button,
  #hk-toolbar-portal:hover,
  #hk-toolbar-portal.ytp-button:hover,
  #hk-toolbar-portal:focus,
  #hk-toolbar-portal.ytp-button:focus {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 48px !important;
    height: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    vertical-align: top !important;
    position: relative !important;
    float: left !important;
    background: none !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
  }

  #hk-toolbar-portal::before,
  #hk-toolbar-portal::after,
  #hk-toolbar-portal:hover::before,
  #hk-toolbar-portal:hover::after {
    display: none !important;
    content: none !important;
    background: transparent !important;
  }

  .hk-toolbar-wrapper {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    height: 100% !important;
    width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    position: relative !important;
  }

  .hk-yt-switch {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: transparent !important;
    border: none !important;
    cursor: pointer !important;
    padding: 0 !important;
    margin: 0 !important;
    -webkit-tap-highlight-color: transparent;
    opacity: 0.85;
    transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box !important;
    width: 36px !important;
    height: 20px !important;
  }

  .hk-yt-switch:hover {
    opacity: 1;
  }

  .hk-yt-switch:active {
    transform: scale(0.95);
  }

  .hk-yt-switch:focus-visible {
    outline: none;
  }

  .hk-yt-switch:focus-visible .hk-yt-switch-track {
    outline: 2px solid rgba(255, 255, 255, 0.8) !important;
    outline-offset: 2px !important;
  }

  .hk-yt-switch-track {
    position: relative !important;
    width: 36px !important;
    height: 20px !important;
    background: rgba(255, 255, 255, 0.25) !important;
    border-radius: 10px !important;
    transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    display: block !important;
  }

  .hk-yt-switch.is-on .hk-yt-switch-track {
    background: #a855f7 !important;
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.4) !important;
  }

  .hk-yt-switch.is-error .hk-yt-switch-track {
    background: rgba(248, 113, 113, 0.5) !important;
  }

  .hk-yt-switch-thumb {
    position: absolute !important;
    left: 2px !important;
    top: 2px !important;
    width: 16px !important;
    height: 16px !important;
    background: #fff !important;
    border-radius: 50% !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) !important;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
  }

  .hk-yt-switch.is-on .hk-yt-switch-thumb {
    transform: translateX(16px) !important;
  }

  .hk-yt-switch.is-error .hk-yt-switch-thumb {
    background: #fee2e2 !important;
  }

  .hk-yt-switch:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hk-yt-switch-icon {
    font-size: 9px !important;
    font-weight: 800 !important;
    font-family: 'Noto Sans JP', sans-serif !important;
    color: rgba(0, 0, 0, 0.45) !important;
    line-height: 1 !important;
    transition: color 0.3s ease;
    user-select: none !important;
    margin-top: 1px !important;
    display: block !important;
  }

  .hk-yt-switch.is-on .hk-yt-switch-icon {
    color: #a855f7 !important;
  }

  .hk-spinner-small {
    width: 12px !important;
    height: 12px !important;
    border: 2px solid rgba(0, 0, 0, 0.1) !important;
    border-top-color: rgba(0, 0, 0, 0.5) !important;
    border-radius: 50% !important;
    animation: hk-spin 0.6s linear infinite !important;
  }

  .hk-error-mark-small {
    font-size: 13px;
    font-weight: 900;
    color: #ef4444;
    line-height: 1;
  }

  @keyframes hk-spin {
    to { transform: rotate(360deg); }
  }

  /* ── Settings Menu ─────────────────────────────────────────── */
  .hk-toolbar-menu {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 15px;
    background: rgba(9, 9, 11, 0.95);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 12px;
    min-width: 200px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 10001;
    cursor: default;
    color: #f4f4f5;
    font-family: 'Inter', 'Segoe UI', sans-serif;
  }
  
  .hk-toolbar-menu-header {
    font-size: 11px;
    font-weight: 700;
    color: rgba(244, 244, 245, 0.5);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 8px;
    text-align: left;
  }

  .hk-sub__settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
    color: rgba(244, 244, 245, 0.75);
    padding: 2px 0;
  }

  .hk-sub__settings-row label {
    cursor: pointer;
  }

  .hk-sub__settings-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    position: relative;
    transition: all 0.15s ease;
  }

  .hk-sub__settings-checkbox:hover {
    border-color: rgba(168, 85, 247, 0.5);
  }

  .hk-sub__settings-checkbox:checked {
    background: #a855f7;
    border-color: #a855f7;
  }

  .hk-sub__settings-checkbox:checked::after {
    content: '✓';
    position: absolute;
    top: -1px;
    left: 2px;
    font-size: 11px;
    color: white;
    font-weight: bold;
  }
`;
