export const youtubeToolbarCss = `
  /* ── Hide native YouTube captions when Hakkutsu is active ── */
  #movie_player.hk-subs-active .ytp-caption-window-container,
  #movie_player.hk-subs-active .caption-window,
  #movie_player.hk-subs-active .captions-text,
  #movie_player.hk-subs-active .ytp-caption-segment,
  .html5-video-player.hk-subs-active .ytp-caption-window-container,
  .html5-video-player.hk-subs-active .caption-window,
  .html5-video-player.hk-subs-active .captions-text,
  .html5-video-player.hk-subs-active .ytp-caption-segment {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* ── Native YouTube Player Control Button ─────────────────────── */
  #hk-toolbar-portal,
  #hk-toolbar-portal.ytp-button,
  #hk-toolbar-portal:hover,
  #hk-toolbar-portal.ytp-button:hover,
  #hk-toolbar-portal:focus,
  #hk-toolbar-portal.ytp-button:focus,
  .html5-video-player #hk-toolbar-portal,
  .html5-video-player #hk-toolbar-portal:hover,
  .html5-video-player #hk-toolbar-portal.ytp-button:hover,
  .ytp-right-controls #hk-toolbar-portal,
  .ytp-right-controls #hk-toolbar-portal:hover,
  .ytp-right-controls #hk-toolbar-portal.ytp-button:hover,
  .ytp-chrome-bottom #hk-toolbar-portal,
  .ytp-chrome-bottom #hk-toolbar-portal:hover {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 48px !important;
    height: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    border-radius: 0 !important;
  }

  #hk-toolbar-portal::before,
  #hk-toolbar-portal::after,
  #hk-toolbar-portal:hover::before,
  #hk-toolbar-portal:hover::after,
  #hk-toolbar-portal *::before,
  #hk-toolbar-portal *::after {
    display: none !important;
    content: none !important;
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
  }

  .hk-toolbar-wrapper,
  .hk-toolbar-wrapper:hover {
    position: relative !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    height: 100% !important;
    vertical-align: top !important;
    background: transparent !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  .hk-yt-btn,
  .hk-yt-btn:hover,
  .hk-yt-btn:focus,
  .hk-yt-btn:active {
    position: relative !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 48px !important;
    height: 100% !important;
    background: transparent !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    cursor: pointer !important;
    padding: 0 !important;
    margin: 0 !important;
    color: #eee !important;
    opacity: 0.85 !important;
    transition: opacity 0.15s ease, transform 0.15s ease !important;
    -webkit-tap-highlight-color: transparent !important;
    box-sizing: border-box !important;
  }

  .hk-yt-btn:hover {
    opacity: 1 !important;
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
  }

  .hk-yt-btn:active {
    transform: scale(0.92) !important;
  }

  .hk-yt-btn:focus-visible {
    outline: none !important;
  }

  .hk-yt-btn__icon-wrapper {
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 28px !important;
    height: 28px !important;
    border-radius: 50% !important;
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
    transition: all 0.2s ease !important;
  }

  .hk-yt-btn.is-active .hk-yt-btn__icon-wrapper {
    color: #fff !important;
  }

  .hk-yt-btn.is-off .hk-yt-btn__icon-wrapper {
    opacity: 0.45 !important;
  }

  /* YouTube-style active indicator bar at the bottom */
  .hk-yt-btn__active-bar {
    position: absolute !important;
    bottom: 0 !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: 24px !important;
    height: 3px !important;
    background: #a855f7 !important;
    border-radius: 2px 2px 0 0 !important;
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.7) !important;
    opacity: 0 !important;
    transition: opacity 0.2s ease, transform 0.2s ease !important;
  }

  .hk-yt-btn.is-active .hk-yt-btn__active-bar {
    opacity: 1 !important;
  }

  .hk-yt-btn__kanji {
    font-size: 16px !important;
    font-weight: 900 !important;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', sans-serif !important;
    line-height: 1 !important;
    letter-spacing: -0.5px !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5) !important;
    user-select: none !important;
  }

  .hk-yt-btn__badge {
    position: absolute !important;
    top: 2px !important;
    right: 2px !important;
    width: 7px !important;
    height: 7px !important;
    border-radius: 50% !important;
    border: 1px solid #18181b !important;
  }

  .hk-yt-btn__badge--error {
    background: #ef4444 !important;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.8) !important;
  }

  .hk-yt-btn__kanji--loading {
    opacity: 0.6 !important;
    transform: scale(0.85) !important;
  }

  .hk-yt-btn__spinner-overlay {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: none !important;
  }

  .hk-yt-btn__spinner {
    width: 22px !important;
    height: 22px !important;
    border: 2px solid rgba(255, 255, 255, 0.15) !important;
    border-top-color: #c084fc !important;
    border-right-color: #a855f7 !important;
    border-radius: 50% !important;
    display: inline-block !important;
    box-sizing: border-box !important;
    animation: hk-spin 0.75s linear infinite !important;
  }

  @keyframes hk-spin {
    to { transform: rotate(360deg); }
  }

  /* ── Drag & Drop Subtitle Dropzone ──────────────────────────── */
  .hk-sub__dropzone {
    position: absolute !important;
    inset: 0 !important;
    border: 3px dashed #a855f7 !important;
    background: rgba(168, 85, 247, 0.18) !important;
    backdrop-filter: blur(8px) !important;
    border-radius: 12px !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    z-index: 99999 !important;
    pointer-events: none !important;
    color: #ffffff !important;
    font-family: 'Inter', system-ui, sans-serif !important;
    animation: hk-sub-fade-in 0.15s ease-out !important;
  }

  .hk-sub__dropzone-icon {
    font-size: 40px !important;
    margin-bottom: 8px !important;
  }

  .hk-sub__dropzone-text {
    font-size: 16px !important;
    font-weight: 700 !important;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8) !important;
  }

  .hk-sub__dropzone-sub {
    font-size: 12px !important;
    opacity: 0.85 !important;
    margin-top: 4px !important;
  }

  /* ── Subtitle Offset Controls ──────────────────────────────── */
  .hk-sub__offset-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 600;
    color: #e4e4e7;
  }

  .hk-sub__offset-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 2px 0;
  }

  .hk-sub__offset-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f4f4f5;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.15s ease;
  }

  .hk-sub__offset-btn:hover {
    background: rgba(168, 85, 247, 0.3);
    border-color: #a855f7;
  }

  /* ── File Upload / Track Switcher in Menu ───────────────────── */
  .hk-sub__file-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 6px;
    color: #f4f4f5;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .hk-sub__file-btn:hover {
    background: rgba(168, 85, 247, 0.28);
    border-color: #a855f7;
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 12px;
    min-width: 220px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
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
