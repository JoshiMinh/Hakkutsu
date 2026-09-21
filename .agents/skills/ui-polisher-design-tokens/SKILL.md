---
name: ui-polisher-design-tokens
description: UI/UX design polishing, design token architecture, modern CSS variables, micro-interactions, dark/light contrast ratios, glassmorphism, responsive modals, and accessible focus management.
---

# UI Polisher & Design Tokens Guide

Use this skill when designing UI components, refining themes, auditing dark/light mode visual contrast, adding fluid micro-interactions, or standardizing design token variables.

## 1. Design Tokens & CSS Variable Architecture
* **Color Hierarchy:**
  * Background layers: `--bg-primary` (deep canvas), `--bg-secondary` (card/surface), `--bg-tertiary` (hover/input), `--bg-glass` (backdrop blur).
  * Text scales: `--text-primary` (high-contrast headers/body), `--text-secondary` (labels/subtitles), `--text-muted` (hints/meta), `--text-accent` (interactive highlights).
  * Semantic Accents: Clear distinguishing hues for success, warning, destructive, and primary actions.
* **Typography & Spacing Scale:**
  * Consistent font scale: `11px`, `12px`, `14px`, `16px`, `20px`, `24px`.
  * 4px / 8px spacing rhythm: `--space-xs` (4px), `--space-sm` (8px), `--space-md` (12px), `--space-lg` (16px), `--space-xl` (24px).

## 2. Micro-Interactions & Motion
* **Transitions:**
  * Fast (150ms) for button hovers and toggles.
  * Normal (250ms) for modal overlays, dropdowns, and card flips.
  * Smooth easing curves: `cubic-bezier(0.16, 1, 0.3, 1)` for snappy popups.
* **Feedback States:** Every clickable element must have distinct `hover`, `active`, and `disabled` visual states.

## 3. Accessibility & Contrast (WCAG 2.1)
* **Contrast Ratios:** Ensure at least 4.5:1 for normal text and 3:1 for large text / graphical controls in dark and light themes.
* **Focus Rings:** Visible, high-contrast focus rings (`outline: 2px solid var(--accent)`) for all interactive elements during keyboard navigation (<kbd>Tab</kbd>).
* **Scrollbars & Glassmorphism:** Custom slim scrollbar tracks (`scrollbar-width: thin`, styled thumb) and performant `backdrop-filter: blur(12px)`.

