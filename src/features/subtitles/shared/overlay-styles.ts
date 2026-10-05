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

  /* ── Subtitle Container ──────────────────────────────────── */
  .hk-sub__container {
    position: absolute;
    bottom: 68px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    z-index: 9999;
    width: 90%;
    max-width: 960px;
    pointer-events: auto;
    transition: bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, transform 0.25s ease;
  }

  .hk-sub__container--hidden {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
    pointer-events: none;
  }

  /* Adjust position when YouTube controls are visible vs hidden */
  .html5-video-player:not(.ytp-autohide) .hk-sub__container {
    bottom: 78px;
  }

  .html5-video-player.ytp-autohide .hk-sub__container {
    bottom: 42px;
  }

  /* ── Subtitle Bar ──────────────────────────────────────────── */
  .hk-sub__bar {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
    gap: 0;
    background: rgba(13, 13, 17, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    padding: 0.6em 16px 5px;
    border-radius: 12px;
    box-shadow:
      0 20px 48px -8px rgba(0, 0, 0, 0.85),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    cursor: text;
    line-height: 1.35;
    font-size: 26px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic Pro", "Yu Gothic", sans-serif;
    color: #f4f4f5;
    user-select: text;
    -webkit-user-select: text;
    overflow: visible;
    transition: background 0.2s ease, border-color 0.2s ease;
    animation: hk-sub-fade-in 0.18s ease-out;
  }

  .hk-sub__bar:hover {
    background: rgba(13, 13, 17, 0.98);
    border-color: rgba(168, 85, 247, 0.5);
  }

  /* ── Secondary Subtitle Bar (Dual Subtitles) ──────────────── */
  .hk-sub__secondary-bar {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    margin-top: 6px;
    padding: 6px 16px;
    background: rgba(13, 13, 17, 0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
    color: #e4e4e7;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: center;
    pointer-events: auto;
    user-select: text;
    animation: hk-sub-fade-in 0.15s ease-out;
  }

  /* ── Individual Token ────────────────────────────────────── */
  .hk-sub__token {
    display: inline-block;
    vertical-align: baseline;
    position: relative;
    padding: 0 1px;
    margin: 0;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .hk-sub__token:hover {
    background: rgba(168, 85, 247, 0.22);
    transform: scale(1.04);
  }

  .hk-sub__token:active {
    background: rgba(168, 85, 247, 0.35);
  }

  .hk-sub__token--particle {
    color: rgba(244, 244, 245, 0.55);
  }

  .hk-sub__token--particle:hover {
    color: rgba(244, 244, 245, 0.9);
  }

  /* JLPT level color coding */
  .hk-sub__token--saved {
    color: #c084fc;
    border-bottom: 2px dotted #c084fc;
  }

  /* ── Furigana (Ruby) ─────────────────────────────────────── */
  .hk-sub__token ruby {
    display: ruby;
    ruby-position: over;
    ruby-align: center;
  }

  .hk-sub__token rt,
  .hk-sub__furigana {
    font-size: 0.42em;
    line-height: 1;
    opacity: 0.9;
    color: #c084fc;
    font-weight: 600;
    text-align: center;
    letter-spacing: -0.02em;
    white-space: nowrap;
    user-select: none;
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
    justify-content: center;
    gap: 5px;
    margin-bottom: 6px;
    padding: 3px 12px;
    border-radius: 999px;
    background: rgba(9, 9, 11, 0.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    font: 600 10px/1.4 'Inter', system-ui, -apple-system, sans-serif;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
    transition: opacity 0.2s ease;
    user-select: none;
  }

  .hk-sub__overlay-wrapper:hover .hk-sub__brand {
    opacity: 0.2;
  }

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
    align-items: center;
    gap: 6px;
    background: rgba(9, 9, 11, 0.95);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    padding: 4px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    opacity: 0;
    pointer-events: none;
    transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    z-index: 99999;
    white-space: nowrap;
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
    right: 0;
    width: 280px;
    height: 100%;
    background: rgba(9, 9, 11, 0.94);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    overflow-y: auto;
    z-index: 9998;
    padding: 14px 10px;
    pointer-events: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.15) transparent;
  }

  .hk-sub__transcript::-webkit-scrollbar {
    width: 5px;
  }

  .hk-sub__transcript::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .hk-sub__transcript-item {
    display: flex;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    transition: background 0.15s ease, color 0.15s ease;
    line-height: 1.5;
    font-family: 'Noto Sans JP', sans-serif;
    border-left: 2px solid transparent;
  }

  .hk-sub__transcript-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.95);
  }

  .hk-sub__transcript-item--active {
    background: rgba(168, 85, 247, 0.12);
    color: #c084fc;
    border-left-color: #a855f7;
  }

  .hk-sub__transcript-time {
    font-size: 11px;
    opacity: 0.6;
    white-space: nowrap;
    padding-top: 2px;
    font-family: 'Inter', monospace;
    min-width: 38px;
  }

  .hk-sub__transcript-text {
    flex: 1;
  }

  /* ── Font Size Presets ─────────────────────────────────────── */
  .hk-sub--small .hk-sub__bar {
    font-size: 20px !important;
    padding: 0.6em 12px 4px !important;
  }
  .hk-sub--small .hk-sub__secondary-bar {
    font-size: 13px !important;
  }

  .hk-sub--medium .hk-sub__bar {
    font-size: 26px !important;
    padding: 0.6em 16px 5px !important;
  }
  .hk-sub--medium .hk-sub__secondary-bar {
    font-size: 15px !important;
  }

  .hk-sub--large .hk-sub__bar {
    font-size: 32px !important;
    padding: 0.6em 20px 7px !important;
  }
  .hk-sub--large .hk-sub__secondary-bar {
    font-size: 18px !important;
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
