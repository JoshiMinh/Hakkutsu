# Subtitle performance validation — 2.6.2

Validated on 2026-10-20. No version bump or saved-data migration.

## Changes

- One decoded-frame callback loop and one set of media listeners per video, shared by cue synchronization and auto-pause. The timer fallback stops while paused and after the last subscriber leaves.
- Cue lookup examines only the latest eligible cue after binary search. Silent gaps no longer trigger backwards track scans; cues lasting longer than 60 seconds also remain active correctly.
- Player discovery ignores caption and application UI mutations, measures each video once per scan, and still detects player replacement and playback changes.
- Native cue objects retain identity when their text/timing is unchanged, avoiding unnecessary React updates. Transcript navigation uses indexed row positions and timestamp searches.
- Current-cue tokens render immediately. Reading enrichment uses a shared prioritized queue with two active requests and at most 64 waiting requests per UI context. Unmounted/off-screen queued consumers are discarded; duplicate requests are shared. Background caching also deduplicates the video/sidebar requests across contexts.
- Kana-only reading analysis avoids remote dictionary requests; repeated kanji lookups within a cue share their in-flight requests. Automatic reading failures leave immediate tokens available instead of launching full LLM analysis. Explicit definition analysis retains its normal route.
- Disabled furigana does not request automatic readings. Pending translations are deduplicated and successful late results remain cached for replay.
- YouTube caption fallbacks start after 200/400ms if a preceding route is still pending, or immediately on failure. Fast downloads do not launch fallback requests. Track switches and successful responses abort unused direct/page requests and clear timers/listeners; JSON3 and background fallbacks remain supported.

## Evidence

| Check | Result |
| --- | --- |
| `node --test tests/*.test.cjs` | 32 tests passed |
| `tests/subtitles.html` | 3 browser scenarios passed |
| Existing `tests/furigana.html` | 20 browser scenarios passed |
| TypeScript and Chrome MV3 / Firefox MV2 builds | Passed |
| Locale parity | All English keys present in the other seven locales |
| `git diff --check` | Passed |

The instrumented synthetic benchmark used 10,000 densely timed cues and 500 lookups in a silent gap. Cue-entry reads fell from **15,007,000 to 8,000** (99.95% fewer). Local timings were approximately 3,305ms before and 3.4ms after; proxy instrumentation and machine load affect these timings, so they are not a claim about end-to-end playback speed.

The browser fixture committed initial subtitle text in approximately **13ms**, while deliberately holding its reading response. It verified stale-response rejection, replay caching, seeking, auto-pause, disabled furigana, observer disposal, and virtualization with a 10,000-cue transcript. Caption transport tests use deterministic timers to verify the 200ms fallback and cancellation behavior.

These are deterministic local tests, not live YouTube/Netflix service or DRM playback tests. Already-running extension messages cannot be recalled; cancelled consumers stop waiting and queued work is removed. Background caption fetches already started retain their existing bounded timeout.

Run the browser fixtures with `node node_modules/vite/bin/vite.js --config tests/vite.config.ts`. Raw local evidence is saved under ignored `test-results/subtitle-*.json` and `test-results/subtitle-browser.*`.
