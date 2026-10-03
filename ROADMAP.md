# Hakkutsu Feature Roadmap

## Local manga OCR

Keep processing local with the bundled `jpn` and `jpn_vert` Tesseract models. Automatic scans should cover dialogue, thoughts, and readable Japanese signs. Stylized sound effects remain available through manual selection. Confidence is a filtering signal, not a probability of correctness.

### Implemented baseline

- [x] Use PSM 5 for vertical crops and PSM 6 for horizontal crops, with a white recognition border and explicit orientation precedence.
- [x] Preserve thin boundaries, share crop/page validation, assemble vertical columns, retain furigana image bounds, and recover uncovered page text.
- [x] Carry crop transforms through original-image and screenshot paths; clamp selections and reject results from changed image sources.
- [x] Keep separate manual regions selectable, preserve outside highlights, and attach unfiltered crops.
- [x] Add editable OCR text and Reanalyze; invalidate stale analysis and prevent saving mismatched text.
- [x] Suppress overlapping region alternatives and keep highlight padding, borders, and hover effects from expanding into neighboring regions.
- [x] Validate connected ink outside candidate rectangles and apply stronger filtering to weak short borderless guesses.
- [x] Repair the overlay harness and add regression coverage. Current baseline: 94 tests, TypeScript, Chrome MV3 build, and Firefox MV2 build pass.

### P0 — Reliable regions without overlaps or missing dialogue

- [ ] Add reproducible fixtures from pristine source pages, rather than screenshots containing OCR highlights or lookup popups. Include the reported vertical sign, upper bubble, borderless thoughts, lower dialogue, furigana, and separate speakers.
- [ ] Track raw fragment bounds, crop/page provenance, chosen orientation, confidence, and rejection reasons in local diagnostic output. Keep these details out of ordinary lookup flows.
- [ ] Improve grouping so each bubble or thought passage forms one region without enclosing neighboring artwork. Avoid letting noisy fragments expand a readable region across flowers, hair, or panel borders.
- [ ] Recover missing words and columns without reintroducing nested alternatives. Accept additional text only when its glyph bounds support uncovered text; resolve competing readings for the same pixels once.
- [ ] Refine artwork filtering against hair, eyes, windows, panel frames, screentones, and decorative marks. Check that stricter filtering does not hide genuine small dialogue, short signs, or the upper bubble in a clipped selection.
- [ ] Extend overlap regressions to containment, partial intersections, mixed orientations, furigana, repeated selections, and adjacent boxes at different zoom levels. Check final displayed rectangles as well as OCR bounds.

Acceptance: zero intersecting clickable regions on the fixture set; no face or whole-panel highlights; readable dialogue remains available; separate speakers remain independently selectable.

### P1 — Improve transcription and ordering

- [ ] Compare crop scale, white-border size, grayscale/contrast settings, and optional binarization using the bundled models. Select preprocessing from measured results instead of applying aggressive cleanup universally.
- [ ] Evaluate both directions for ambiguous text-column geometry and compare coherent Japanese readings. Preserve explicit user orientation and avoid choosing a confident artwork hallucination.
- [ ] Fix vertical sign transcription as a complete phrase, including the ending. Do not hardcode corrections for a particular page or sign.
- [ ] Improve glyph/word ordering when Tesseract returns overlapping column bounds, uneven column lengths, or fragmented words. Exclude furigana readings from body text while retaining their crop bounds.
- [ ] Make prolonged-mark repair depend on assembled text and glyph geometry. Preserve genuine digits, punctuation, numeric runs, and Latin suffixes such as `V`.
- [ ] Calibrate confidence and geometry thresholds separately for complete dialogue, short borderless text, signs, and manual selections. Preserve plausible low-confidence columns when neighboring text and original ink support them.

Acceptance: the sign is one correctly ordered phrase; the lower bubbles assemble complete sentences; known furigana, digit, punctuation, and `V` regressions pass; transcription improves without increasing artwork highlights or missed text.

### P1 — Verify selection and correction in real browsers

- [ ] Run live Chrome and Firefox extension smoke tests using original-image and screenshot-fallback paths, partially clipped images, scrolling, resizing, browser zoom, and image-source changes during recognition.
- [ ] Verify one-region selections open lookup, multiple regions stay independently selectable, and new selections preserve unrelated highlights.
- [ ] Verify editing cancels stale analysis, Reanalyze uses the corrected text, and library/Anki saving uses matching analysis and the original region crop.
- [ ] Check keyboard activation, focus return, correction-field usability, and narrow viewports. Ensure hover/focus styling never expands the clickable bounds.

Acceptance: live browser behavior matches the component regressions, with no stale results, overlapping highlights, or text/crop mismatches.

### P2 — Measure quality and scan latency

- [ ] Maintain expected transcripts and expected region bounds for clean synthetic fixtures and representative manga pages with permission to use them.
- [ ] Record character error rate, missed dialogue regions, artwork false positives, overlap count, and reading-order failures. Report quality and coverage together so suppressing uncertain text cannot appear to be an accuracy improvement by itself.
- [ ] Measure cold and warm scan latency separately for image preparation, detection, crop recognition, full-page recovery, grouping, and rendering in both browsers.
- [ ] Keep one full-page recovery operation per scan, retain worker serialization, and optimize repeated pixel analysis or redundant crop work only when measurements identify a bottleneck.
- [ ] Run TypeScript, focused OCR/overlay tests, bundled-model tests, and both browser builds for recognition changes. Record limitations and review results alongside timings.

Acceptance: reproducible before/after quality and latency results; no regression in non-overlap, source isolation, correction safety, or bundled offline operation.

### Remaining limitations

The supplied screenshots currently produce non-overlapping regions, but the sign and some dialogue/thought text still contain character errors. A cropped detail can miss text recognized on the full page. Screenshots with existing overlays also contaminate OCR input. Automated tests and successful builds do not replace validation on pristine pages and live browser smoke tests.
