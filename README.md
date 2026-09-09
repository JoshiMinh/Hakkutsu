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
- **Spaced repetition:** review cards locally with due dates, intervals, repetition counts, and progress statistics.
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
src/components/         Shared React interface components
src/contents/           Dictionary and subtitle implementations
src/entrypoints/          WXT pages, background worker, and content scripts
src/lib/services/       Storage, dictionary, subtitle, Anki, and SRS services
src/lib/utils/          Shared types and language utilities
wxt.config.ts           Extension manifest and WXT configuration
```

## Load an unpacked build

1. Run `pnpm build`.
2. Open `chrome://extensions` in a Chromium browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `.output/chrome-mv3`.

For Firefox development, run `pnpm build:firefox` and load `.output/firefox-mv2/manifest.json` as a temporary add-on from `about:debugging`.

## Contributing

Issues and focused pull requests are welcome. Before submitting a change, run `pnpm typecheck`, `pnpm build`, and `pnpm build:firefox`.

## License

[MIT](LICENSE) © Hakkutsu contributors.
