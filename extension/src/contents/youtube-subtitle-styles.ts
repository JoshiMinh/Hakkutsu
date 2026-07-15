/**
 * CSS styles for the YouTube subtitle overlay.
 *
 * Returns a CSS string to be injected via Plasmo's getStyle().
 * Uses the Hakkutsu design tokens (--hk-*) for consistency.
 */

export const youtubeSubtitleCss = /* css */ `
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

  /* ── Subtitle Bar (glassmorphic) ─────────────────────────── */
  .hk-sub__bar {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 1px;
    background: rgba(10, 10, 20, 0.82);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px 20px 12px;
    border-radius: 12px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    cursor: text;
    line-height: 1.8;
    font-size: 26px;
    user-select: text;
    -webkit-user-select: text;
    transition: background 0.2s ease;
  }

  .hk-sub__bar:hover {
    background: rgba(10, 10, 20, 0.92);
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
    color: #f0eff4;
  }

  .hk-sub__token:hover {
    background: rgba(240, 198, 116, 0.15);
    transform: scale(1.02);
  }

  .hk-sub__token:active {
    background: rgba(240, 198, 116, 0.25);
  }

  .hk-sub__token--particle {
    color: rgba(240, 239, 244, 0.6);
  }

  .hk-sub__token--particle:hover {
    color: rgba(240, 239, 244, 0.9);
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
    opacity: 0.85;
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

  /* ── Native Toolbar Integration ──────────────────────────── */
  .hk-toolbar-wrapper {
    display: inline-block;
    position: relative;
    vertical-align: top;
  }

  .hk-toolbar-btn {
    opacity: 0.9;
    transition: opacity 0.1s;
    font-weight: bold;
    font-size: 13px;
    font-family: 'Inter', 'Noto Sans JP', sans-serif;
    color: #eee;
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    height: 100%;
    padding: 0 8px;
  }

  .hk-toolbar-btn:hover {
    opacity: 1;
  }

  .hk-toolbar-btn--active {
    color: var(--hk-accent-crimson, #e85d75);
    text-shadow: 0 0 8px rgba(232, 93, 117, 0.4);
  }

  .hk-toolbar-btn--loading {
    animation: hk-pulse 1.5s infinite;
  }
  
  .hk-toolbar-btn--loading .hk-toolbar-icon {
    filter: drop-shadow(0 0 6px rgba(240, 198, 116, 0.8));
  }
  
  .hk-toolbar-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    transition: transform 0.15s ease, filter 0.15s ease;
    vertical-align: middle;
  }
  
  .hk-toolbar-btn:hover .hk-toolbar-icon {
    transform: scale(1.1);
  }
  
  .hk-toolbar-btn--active .hk-toolbar-icon {
    filter: drop-shadow(0 0 4px rgba(232, 93, 117, 0.6));
  }
  
  @keyframes hk-pulse {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
  }

  .hk-toolbar-menu {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 15px;
    background: rgba(15, 15, 26, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 12px;
    min-width: 200px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 10001;
    cursor: default;
    color: #e8e6f0;
    font-family: 'Inter', 'Noto Sans JP', sans-serif;
  }
  
  .hk-toolbar-menu-header {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 8px;
    text-align: center;
  }

  }

  .hk-sub__settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
  }

  .hk-sub__settings-row label {
    cursor: pointer;
  }

  .hk-sub__settings-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    position: relative;
    transition: all 0.15s ease;
  }

  .hk-sub__settings-checkbox:checked {
    background: var(--hk-accent-crimson, #e85d75);
    border-color: var(--hk-accent-crimson, #e85d75);
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

  /* ── Transcript Panel ────────────────────────────────────── */
  .hk-sub__transcript-toggle {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;
    line-height: 1;
  }

  .hk-sub__transcript-toggle:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .hk-sub__transcript-toggle--active {
    color: var(--hk-accent-gold, #f0c674);
  }

  .hk-sub__transcript {
    position: absolute;
    top: 0;
    right: -280px;
    width: 260px;
    height: 100%;
    background: rgba(10, 10, 20, 0.9);
    backdrop-filter: blur(12px);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    overflow-y: auto;
    z-index: 9998;
    padding: 12px 8px;
    pointer-events: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.15) transparent;
  }

  .hk-sub__transcript::-webkit-scrollbar {
    width: 4px;
  }

  .hk-sub__transcript::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }

  .hk-sub__transcript-item {
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    transition: background 0.15s ease, color 0.15s ease;
    line-height: 1.5;
    font-family: 'Noto Sans JP', sans-serif;
  }

  .hk-sub__transcript-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
  }

  .hk-sub__transcript-item--active {
    background: rgba(240, 198, 116, 0.1);
    color: var(--hk-accent-gold, #f0c674);
    border-left: 2px solid var(--hk-accent-gold, #f0c674);
  }

  .hk-sub__transcript-time {
    font-size: 10px;
    opacity: 0.5;
    white-space: nowrap;
    padding-top: 2px;
    font-family: 'Inter', monospace;
    min-width: 36px;
  }

  .hk-sub__transcript-text {
    flex: 1;
  }

  /* ── Fade animation for subtitle transitions ─────────────── */
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

  .hk-sub__bar {
    animation: hk-sub-fade-in 0.2s ease-out;
  }

  /* ── Overlay Wrapper & Action Bar ────────────────────────── */
  .hk-sub__overlay-wrapper {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
  }

  .hk-sub__overlay-wrapper:hover .hk-sub__action-bar {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .hk-sub__action-bar {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    background: rgba(15, 15, 26, 0.9);
    backdrop-filter: blur(8px);
    padding: 6px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    opacity: 0;
    pointer-events: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  .hk-sub__action-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.05);
    color: #e8e6f0;
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
    background: rgba(240, 198, 116, 0.2);
    border-color: rgba(240, 198, 116, 0.4);
    color: var(--hk-accent-gold, #f0c674);
    transform: translateY(-1px);
  }

  .hk-sub__action-btn:active {
    transform: translateY(1px);
  }
`;
