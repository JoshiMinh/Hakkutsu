# Web Extension Doctor: Hakkutsu source layout refactor

Overall status: **WARN — no refactor regressions found; existing issues remain**.
Passed checks: **6**. Warnings: **5**. Critical failures found in the reviewed
application changes: **0**. This is a source/build audit, not store certification.

Audited the completed three-phase source migration with the
`web-extension-auditor` skill. Existing behavior, permissions, dependencies,
storage formats, and offline resources were held constant. Deferred remedies
below are proposals, not changes applied by this refactor.

## Doctor results

| Status | Check | Evidence / location |
| --- | --- | --- |
| PASS | Chrome MV3 / Firefox MV2 manifest parity | Both generated manifests match the pre-Phase-3 manifests. Firefox removes offscreen and uses a background script/sidebar; Chrome uses a service worker/offscreen/side panel. |
| PASS | Shadow DOM and content-context asset URLs | UI entrypoints use `createShadowRootUi` with UI CSS injection. Dictionary/OCR assets use runtime URLs. Root-relative asset paths found in popup/dashboard/settings/vocabulary belong to extension pages. |
| PASS | Background routing and asynchronous responses | `src/app/background.ts` retains synchronous listener registration and `return true` for asynchronous responses. Sidebar opening preserves the user gesture. OCR offscreen requests and transcript broadcasts retain one responder. |
| PASS | Persisted data and offline OCR | Existing IndexedDB/storage contracts and settings defaults are preserved. Both builds contain the local worker, WASM core, and horizontal/vertical Japanese models. The OCR initializer explicitly overrides Tesseract's CDN defaults with runtime asset URLs. |
| PASS | Component lifecycle and bridge ownership | Reviewed dictionary, OCR, generic detection, player timing and transcript listeners/observers/timers have teardown. Main-world bridges have initialization guards and document-lifetime discovery timers. YouTube's caption bridge checks HTTPS, host, timedtext path and current video ID. DOM CustomEvents remain page-visible and are not authentication boundaries. |
| PASS | Application CSP and icon imports | Application TypeScript contains no `eval`, `new Function`, or remote executable script injection. Bridge fallback scripts use packaged runtime URLs. Lucide imports are named. The unique package file total is 11.26 MB, below the skill's 15 MB package budget even before compression; WXT's repeated asset listings are not duplicate physical files. |
| WARN P2 | Broad host/resource scope | Arbitrary-page dictionary lookup, OCR and HTML5 detection justify broad page access. `assets/*` and `ocr/*` are also web-accessible on all URLs. Review exposure independently of this behavior-preserving migration. |
| WARN P1 | Four content scripts exceed size budgets | Dictionary and the three subtitle overlays exceed both 400 kB raw and 120 kB gzip budgets; see measurements below. |
| WARN P1 | Weak IPC payload contracts | `src/shared/browser/messages.ts` uses a message-type union with `payload?: unknown`; several handlers rely on assertions rather than runtime guards. Extraction preserved this pre-existing contract. |
| WARN P1 | Privacy disclosure and network consent need review | `privacy.html` claims 100% local processing/no third-party transmissions. Dictionary translation/TTS/search/illustration features contact external services. No separate affirmative network-consent preference was found in the settings contract. The README is more qualified than the public policy. |
| WARN P2 | Vendor dynamic-function fallback branches | Shipped Tesseract/regenerator bundles contain `Function(...)` fallback expressions. Inspected branches prefer `globalThis`, so these fallbacks are not selected in current supported browser environments. They are vendor code, not application-authored execution; do not infer zero dynamic-function strings or store certification from the source scan. |

## Bundle measurements

The same script sizes occur in both production targets. Units are decimal kB;
gzip is measured with Node's `zlib.gzipSync`, not inferred from filenames.

| Script | Raw kB | Gzip kB | Budget |
| --- | ---: | ---: | --- |
| generic-subtitles-detector | 16.17 | 5.20 | PASS |
| inline-dictionary | 561.18 | 168.15 | WARN |
| generic-subtitles | 500.49 | 138.99 | WARN |
| netflix-subtitles | 491.84 | 137.69 | WARN |
| youtube-subtitles | 492.87 | 139.66 | WARN |
| netflix-bridge | 6.35 | 2.54 | PASS |
| youtube-bridge | 7.03 | 2.78 | PASS |

## Deferred remediation

### Resource exposure

Inventory assets requested from content contexts and replace wildcards with
explicit paths where possible. Keep arbitrary-site coverage unless the product
is deliberately changed to user-activated access. For example, an explicit
asset group could replace the wildcard group after checking all content callers:

```ts
{
  resources: [
    "assets/icon.png",
    "ocr/worker.min.js",
    "ocr/tesseract-core-simd-lstm.js",
    "ocr/tesseract-core-simd-lstm.wasm",
    "ocr/jpn.traineddata.gz",
    "ocr/jpn_vert.traineddata.gz",
  ],
  matches: ["<all_urls>"],
}
```

Retain the existing separate YouTube/Netflix bridge groups and account for any
other icon callers before applying this proposal. No permissions were removed.

### Content bundle budgets

Separate heavyweight OCR/management dependencies from always-injected lookup UI
and measure the complete loading graph. A later change can defer non-critical
surfaces, for example:

```tsx
const MangaOcrImages = React.lazy(() =>
  import("~/features/ocr/manga-ocr-images").then(module => ({
    default: module.MangaOcrImages,
  })),
);
```

Add a loading boundary and verify WXT's emitted content-script chunk/runtime URL
behavior on both browsers, native image documents, and offline pages. Do not
apply a lazy import alone without those checks; current startup behavior was
deliberately preserved.

### IPC validation

Define payload-specific request unions and validate untrusted values at the
router boundary without renaming wire messages. For example:

```ts
type AnalyzeTextMessage = {
  type: "ANALYZE_TEXT";
  payload: { text: string; include_definitions?: boolean };
};

function isAnalyzeTextMessage(value: unknown): value is AnalyzeTextMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; payload?: unknown };
  if (message.type !== "ANALYZE_TEXT" || !message.payload ||
      typeof message.payload !== "object") return false;
  const payload = message.payload as { text?: unknown; include_definitions?: unknown };
  return typeof payload.text === "string" &&
    (payload.include_definitions === undefined ||
      typeof payload.include_definitions === "boolean");
}
```

Cover every request before replacing the current envelope. Also validate URL
schemes/hosts and numeric bounds appropriate to each operation. The example
does not establish a new text-length policy or change persisted data.

### Privacy and affirmative network choices

Replace the absolute public claims with a precise disclosure, such as:

```html
<p>Flashcards, preferences, local dictionaries and OCR processing stay on your
device. Translation, pronunciation, online dictionary and illustration features
may send the requested text to external providers when those features are used.
Anki export connects to your local AnkiConnect endpoint.</p>
```

Inventory providers and automatic lookup/translation triggers, then design
explicit consent and an offline-only mode that avoids every external text
request. Such controls require product decisions and new persisted preferences;
they were not introduced during this storage-preserving cleanup. Website CDN
scripts in `privacy.html` are not shipped extension executable code.

### Vendor CSP fallbacks

Prefer dependency distributions that do not contain legacy dynamic-function
fallbacks. The intended static replacement pattern is:

```js
const runtimeGlobal = globalThis;
runtimeGlobal.regeneratorRuntime = runtime;
```

Apply this upstream or through a maintained, reviewed build change; do not
hand-edit `node_modules` or blindly rewrite minified bundles. Verify worker/core
initialization and supported browser targets before changing vendor code. No
dependency or CSP change was made here.

## Verification and limitations

- TypeScript passed; Chrome and Firefox production builds passed.
- All 137 focused regressions passed, including seven new routing/offscreen
  regressions covering sidebar timing, sender frame/window scope, network errors,
  Anki/SRS/settings/analytics messages and Firefox OCR fallback.
- The broader suite passed 165/167. Existing Edge native-image and Chrome layout
  processes crashed with exit codes `3221225477` and `2147483651`, respectively,
  as they did before this phase. Their real-browser assertions remain unverified.
- Compared extracted logic, move-only executable bodies, contracts/defaults,
  manifests and packaged resources with the pre-Phase-3 snapshot. Colocated CSS
  reconstructs the previous cascade byte for byte. No stale import/fixture paths
  or legacy aliases remain.
- This audit does not certify every third-party dependency, every website, or
  Chrome Web Store/Firefox AMO acceptance. No warning was hidden by loosening
  permissions, changing storage, disabling offline resources, or skipping the
  failing browser tests.
