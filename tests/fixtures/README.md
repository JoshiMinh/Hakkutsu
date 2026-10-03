`manga-layout.png` is a synthetic OCR fixture drawn locally with Windows
System.Drawing and the Yu Gothic font. It contains two vertical dialogue
columns (日本語を勉強します and 今日は晴れです), a horizontal heading
(漫画の発売予定), and panel/speech-bubble outlines. It contains no third-party
manga artwork. The integration test uses the bundled Japanese traineddata
without downloading models.

`manga-dialogue-regions.png` extends that fixture with two vertical columns
inside the left speech bubble (本を読みます and 楽しいです). The OCR integration
test checks that each bubble becomes one dialogue region and the horizontal
heading stays separate. Geometry fixtures in the regression tests additionally
cover punctuation, numbers, furigana, and bubble/panel dividers.

`reliable-regions.png` is a pristine, locally authored page generated from
`reliable-regions.json` by `generate-reliable-regions.ps1`. It covers a vertical
sign, an upper bubble with furigana, borderless thoughts, small dialogue, a
short sign, lower dialogue, and an independent speaker. Connected hair/eyes,
flowers, windows, panel frames, screentones, and decorative strokes provide
negative cases. It contains no screenshots or third-party artwork.

Regenerate on Windows with the Yu Gothic font installed:

```powershell
./tests/fixtures/generate-reliable-regions.ps1
```

The checked-in PNG lets regression tests run without Windows font rendering.
The manifest records transcripts, column positions, allowed passage envelopes,
forbidden artwork areas, and clipped selections. Acceptance checks passage and
glyph coverage together with overlaps and artwork false positives; suppressing
text cannot produce a passing result. Exact sign and thought transcripts are
also asserted by the bundled-model regression.

Run `npm run ocr:diagnostics` for local JSON traces and review images in
`test-results/ocr/` (ignored by Git). The runner uses production recognition,
preprocessing, mapping, validation, recovery, and grouping with bundled models.
Reports contain source/model hashes, raw bounds, crop transforms, orientation,
confidence, and rejection decisions. Nothing is added to ordinary lookup UI,
lookup events, or persistent settings. This fixture substitutes for reported
pages whose pristine originals have not been provided.

`tests/ocr-display-bounds.test.cjs` additionally renders the production component
in headless Chrome and measures actual button rectangles, including thin boxes,
overlapping image elements, and focus styling at 75–200% zoom. It uses the local
Windows Chrome installation or `HAKKUTSU_CHROME_PATH`; the browser measurement
case is skipped when Chrome is unavailable. Local HTML and JSON layout reports
are written under ignored `test-results/ocr/display/`. Component regressions
also check moving lightboxes and restoration of retained highlights.
