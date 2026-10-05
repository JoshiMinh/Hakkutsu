export const netflixSpecificCss = `
  /* ── Subtitle container position on Netflix ── */
  .watch-video .hk-sub__container,
  .VideoContainer .hk-sub__container {
    bottom: 110px;
    transition: bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  }

  .watch-video.active .hk-sub__container,
  .watch-video:hover .hk-sub__container,
  .watch-video--bottom-controls-container:hover ~ * .hk-sub__container {
    bottom: 170px;
  }

  .watch-video.inactive .hk-sub__container {
    bottom: 90px;
  }
`;

