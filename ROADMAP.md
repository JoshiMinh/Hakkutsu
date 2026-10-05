
# Hakkutsu Roadmap

## Source layout refactor

The extension has distinct user features, but shared `components/`, `contents/`, and `lib/services/` folders currently split each feature across the tree. Large components such as the vocabulary list and subtitle overlays also combine rendering, browser events, and feature logic. Group implementation by feature while keeping WXT's required entrypoints as thin registration and mounting files.

### Proposed layout

```text
src/
  entrypoints/                 WXT pages, background, and content-script registration
  app/                         Shared application shell and dashboard navigation
  features/
    dictionary/                Inline lookup, definitions, and Japanese analysis
    subtitles/
      shared/                  Cue parsing, timing, player discovery, transcript state
      youtube/                 YouTube bridge, caption loading, and overlay
      netflix/                 Netflix bridge and overlay
      generic/                 HTML5 track detection and compatible-site overlay
    ocr/                       Manga image selection, region detection, and recognition
    vocabulary/                Vocabulary list, CSV, and data backup
    srs/                       Review UI, scheduling, and card management
    anki/                      AnkiConnect client and export field mapping
    settings/                  Settings views and settings state
    analytics/                 Reading and immersion summaries
  shared/
    ui/                        Reusable controls used by multiple features
    browser/                   Extension APIs and cross-feature browser helpers
    japanese/                  Language utilities used by multiple features
    locales/                   Translation dictionaries and locale lookup
  styles/                      Global styles and cross-feature design tokens
```

Each feature should keep its own components, hooks, services, types, and styles together when those parts have one reason to change. Promote code into `shared/` only when at least two independent features use it. Keep `entrypoints/` stable so the manifest, WXT discovery, and browser registration remain easy to audit.

### Migration sequence

- [ ] Move one bounded feature at a time, starting with Anki or analytics, and update its imports and aliases in the same change.
- [ ] Group subtitle UI and services by platform; extract shared cue and player logic only where the existing implementations have the same behavior.
- [ ] Split vocabulary and settings views into cohesive sections, moving feature-specific data loading and browser interactions into nearby hooks or services.
- [ ] Separate OCR and dictionary modules by responsibility while preserving offline operation and existing storage formats.
- [ ] Break the background worker into message handlers by feature; retain one small entrypoint that registers listeners and routes message types.
- [ ] Move feature styles beside their UI and retain a small global stylesheet for resets, tokens, and genuinely shared primitives.
- [ ] Update path-based test fixtures and source aliases as files move; do not keep old module paths as permanent forwarding layers.

### Acceptance criteria

- [ ] Each WXT entrypoint remains discoverable and has a clear, limited registration role.
- [ ] A feature can be understood and changed by reading its own directory, without pulling unrelated UI or services into it.
- [ ] Shared modules have multiple real feature consumers; no one-use abstraction is introduced just to create a folder boundary.
- [ ] Existing extension behavior, saved user data, browser permissions, and offline capabilities remain intact.
- [ ] TypeScript, focused feature regressions, and Chrome and Firefox production builds pass after each migration stage.
- [ ] Aliases and tests refer to the new ownership boundaries, and no stale imports remain.

Migrate incrementally. Avoid a repository-wide file move, dependency, or manifest rewrite as part of this cleanup.
