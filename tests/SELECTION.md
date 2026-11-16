# Selection and locale checks

Run `pnpm test` for the production analysis pipeline and complete locale audit, and `pnpm typecheck` for locale-key and request contracts.

Run `pnpm test:browser`, then open:

- `http://127.0.0.1:4173/tests/selection.html` for the inline popup.
- `http://127.0.0.1:4173/tests/selection.html?native` for the panel layout.

Both pages run automatically, including the same checks in a child frame. Repeat at phone and desktop widths. The fixtures mock extension storage and external providers; saving uses a disposable in-memory message handler.

Coverage includes complete selections across text nodes, inputs, textareas, contenteditable elements and open shadow roots; keyboard selection; double-click dragging and triple-clicking; word hover with either browser caret API; cancellation and stale replies; all eight UI languages; language changes during requests; localized failure states; saving with sentence context; and keyboard focus in panels.

The Node tests exercise the real message handler, API client, sentence service and tokenizer with external providers stubbed. They verify that short phrases remain multiple tokens and that the explicitly requested language reaches translation, dictionary lookups and local fallbacks. Locale checks compare all resolved keys, placeholders, duplicate keys and literal translation references.

Build both targets with `pnpm build` and `pnpm build:firefox`. Browser fixtures run in connected Chrome; exercising Firefox's caret fallback in the fixture and building Firefox do not constitute a live Firefox installation test. Browser-protected pages and inaccessible closed shadow roots remain subject to browser restrictions.
