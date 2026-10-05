<div align="center">
  <img src="public/assets/icon.png" alt="Hakkutsu" width="112" height="112">
  <h1>Hakkutsu <span lang="ja">発掘</span></h1>
  <p><strong>Read, watch, mine, and review Japanese without leaving the page.</strong></p>

  [Website](https://joshiminh.github.io/Hakkutsu/) · [Privacy](privacy.html) · [Support development](https://ko-fi.com/joshiminh)
</div>

Hakkutsu is a local-first browser extension for Japanese immersion. It combines inline dictionary lookup, interactive video subtitles, sentence mining, AnkiConnect export, and a built-in spaced-repetition deck in one workflow.

## What it does

- **Inline lookup:** select Japanese text on a webpage to see readings, definitions, JLPT level, frequency rank, and pitch-accent information.
- **Video subtitles:** interactive subtitle overlays for YouTube, Netflix, and compatible HTML5 video sites.
- **Sentence mining:** save the current word, sentence, source, image, tags, and learning metadata as a vocabulary card.
- **Spaced repetition:** review cards locally with due dates, intervals, repetition counts, progress statistics, Audio-First mode, and Cloze Deletion (fill-in-the-blank) context recall.
- **Multi-language support:** 8 UI & definition languages — English, Tiếng Việt (Vietnamese), 日本語 (Japanese), 中文 (Chinese), 한국語 (Korean), Español (Spanish), Français (French), and Bahasa Indonesia (Indonesian).
- **AnkiConnect export:** send cards to a configurable local Anki deck and note model.
- **Portable data:** export CSV for interoperability or a full JSON backup that preserves SRS progress and can be merged back into the extension.

## Privacy and storage

Vocabulary and review history are stored locally in the browser using IndexedDB. Settings and compatibility data use extension local storage. Normal extension upgrades preserve this data, but uninstalling the extension, clearing its storage, or deleting the browser profile may remove it. Use **Vocabulary → Backup** periodically if the collection matters to you.

Hakkutsu does not require an account and does not include analytics or advertising. Features that contact a configured translation service or local AnkiConnect endpoint only run when used. See the [privacy policy](privacy.html) for details.

## Browser support

- Chromium browsers: Manifest V3
- Firefox: Manifest V2 compatibility build

Subtitle availability depends on the video site exposing a supported text track or subtitle response. DRM-protected media is not bypassed.

## Development

Requirements: Node.js 18 or newer and pnpm 8 or newer.

```bash
pnpm install
pnpm dev
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start WXT development mode with hot reload |
| `pnpm typecheck` | Run TypeScript validation |
| `pnpm build` | Build the Chrome MV3 extension |
| `pnpm build:firefox` | Build the Firefox MV2 extension |
| `pnpm zip` | Create a store-ready Chrome archive |

Production output is written to `.output/`.

## Project layout

```text
public/                 Packaged images and static assets
src/entrypoints/        WXT pages and script registration/mounting
src/app/                Application shell, navigation, and background routing
src/features/           Dictionary, OCR, Anki, analytics, subtitles, vocabulary, SRS, settings
src/shared/             Cross-feature UI, browser, Japanese, and locale modules
src/styles/             Ordered stylesheet composition, resets, tokens, shared primitives
wxt.config.ts           Extension manifest and WXT configuration
```

See [source ownership](src/README.md) for feature responsibilities and preserved boundaries.

## Load an unpacked build

1. Run `pnpm build`.
2. Open `chrome://extensions` in a Chromium browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `.output/chrome-mv3`.

For Firefox development, run `pnpm build:firefox` and load `.output/firefox-mv2/manifest.json` as a temporary add-on from `about:debugging`.

## Releases

Publishing a GitHub Release builds Chrome and Firefox packages and attaches store-ready ZIPs plus ZIPs containing the unpacked build folders. If store credentials are configured, the workflow also publishes to the Chrome Web Store and submits the Firefox build to Firefox Add-ons (AMO).

To enable store publishing, configure these repository variables and secrets:

| Name | Type | Purpose |
| --- | --- | --- |
| `CHROME_WEB_STORE_EXTENSION_ID` | Variable | Extension ID from the Chrome Web Store dashboard |
| `CHROME_WEB_STORE_PUBLISHER_ID` | Variable | Chrome Web Store publisher account ID |
| `CHROME_WEB_STORE_CLIENT_ID` | Secret | Google API OAuth client ID |
| `CHROME_WEB_STORE_CLIENT_SECRET` | Secret | Google API OAuth client secret |
| `CHROME_WEB_STORE_REFRESH_TOKEN` | Secret | Google API OAuth refresh token |
| `AMO_JWT_ISSUER` | Secret | Firefox Add-ons API key |
| `AMO_JWT_SECRET` | Secret | Firefox Add-ons API secret |

Store steps are skipped when their credentials are missing; GitHub Release assets are still created.

## Contributing

Issues and focused pull requests are welcome. Before submitting a change, run `pnpm typecheck`, `pnpm build`, and `pnpm build:firefox`.

## License

[MIT](LICENSE) © Hakkutsu contributors.
