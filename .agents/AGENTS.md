# Hakkutsu Project Rules

## Architecture
- **Monorepo**: `extension/` (Plasmo + React + TypeScript), `backend/` (FastAPI + Python), `ml/` (Phase 2)
- Follow SOLID principles. Each module has a single responsibility.
- All extension code lives under `extension/src/`. Use Plasmo's file-based routing.

## TypeScript (Extension)
- Strict mode enabled. No `any` types unless absolutely necessary.
- Use `interface` for object shapes, `type` for unions/intersections.
- Name files in kebab-case. Name components in PascalCase.
- Use named exports, not default exports (except Plasmo entry points).
- All API responses must have corresponding TypeScript types in `src/types/`.

## Python (Backend)
- Use type hints on all functions.
- Use Pydantic models for request/response validation.
- Services are stateless — inject dependencies via FastAPI's `Depends`.
- Follow the pattern: endpoint → service → data layer.

## Styling
- Dark-mode first. Use CSS custom properties for theming.
- No Tailwind. Use vanilla CSS with BEM-like naming.
- Japanese aesthetic: subtle gradients, warm accents (amber/crimson), clean typography.

## Git
- Commit messages: `type(scope): description` (e.g., `feat(extension): add text selection handler`)
- Never commit: `.env`, `node_modules/`, `build/`, `__pycache__/`, `*.pyc`, JMdict data files

## Dependencies
- Minimize external dependencies. Prefer built-in APIs.
- Extension: `wanakana` for kana utilities, `firebase` for auth.
- Backend: `sudachipy` for tokenization, `youtube-transcript-api` for subtitles.
