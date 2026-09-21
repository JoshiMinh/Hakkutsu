---
name: web-extension-auditor
description: "Comprehensive WebExtension (Chrome MV3 & Firefox MV2/MV3) audit and optimization skill. Covers Manifest V3/V2 compliance, Content Security Policy (CSP), host permission minimization, content script sandbox isolation (Shadow DOM & CSS scoping), stateless background service workers & typed IPC, bundle size budgets, tree-shaking (icons/dictionaries), dynamic chunk splitting (React.lazy), IndexedDB vs chrome.storage persistence, memory leak lifecycle hygiene, and Chrome Web Store / Firefox AMO review readiness."
metadata:
  author: JoshiMinh
  version: "2.0.0"
---

# Web Extension & Manifest Auditor (Chrome MV3 & Firefox MV2/MV3)

A production-grade engineering and audit skill for auditing, optimizing, and certifying browser extensions built with **WXT**, **Plasmo**, **Vite**, **Webpack**, or modern **React / TypeScript**. Ensures strict adherence to **Manifest V3 (Chromium)** and **Manifest V2/MV3 (Firefox)** standards, zero-remote-code CSP policies, efficient bundle sizing, and Chrome Web Store / Firefox AMO store review compliance.

---

## Audit Principles

1. **Dual-Target Manifest Parity**: Evaluate compatibility across Chromium (Manifest V3 service workers, declarativeNetRequest) and Firefox (Manifest V2/MV3 background scripts, storage).
2. **Context-Aware Sandboxing**: Ensure content scripts run in isolated worlds, encapsulate styling via Shadow DOM, and interact with host page scripts only via explicit messaging or bridge interfaces.
3. **Strict Size Budgets & Tree-Shaking**: Enforce lightweight content script payloads ($< 400\text{ KB}$) to prevent host DOM jank, with lazy loading for heavy dashboards.
4. **Actionable Remediation**: Provide concrete, copy-pasteable TypeScript, React, and WXT/Plasmo configuration snippets for every detected failure or warning.
5. **Standardized CLI Doctor Reporting**: Output diagnostic audits in structured, high-visibility Doctor tables.

---

## 1. Manifest & Permission Minimization (MV3 / MV2)

### A. Principle of Least Privilege
- **Permissions Array**: Request only permissions strictly required for immediate feature execution (e.g. `storage`, `activeTab`, `contextMenus`, `alarms`).
- **Host Permissions**:
  - Avoid `<all_urls>` or `*://*/*` whenever domain-specific patterns (e.g. `*://*.youtube.com/*`, `*://*.netflix.com/*`) or user-invoked `activeTab` suffice.
  - Separate optional features into `optional_permissions` / `optional_host_permissions` requested via `chrome.permissions.request()` on user action.
- **Match Patterns**: Ensure match patterns strictly follow RFC 3986 schemes without invalid regular expression syntax in `manifest.json` / `wxt.config.ts`.

### B. Web Accessible Resources Security
- Never expose entire root directory or sensitive scripts to webpage inspection.
- Explicitly declare `matches` patterns for each entry in `web_accessible_resources` to prevent malicious third-party websites from detecting or fingerprinting the extension:
  ```json
  "web_accessible_resources": [
    {
      "resources": ["assets/icons/*", "assets/fonts/*"],
      "matches": ["https://*.youtube.com/*", "https://*.netflix.com/*"]
    }
  ]
  ```

### C. Declarative Net Request vs webRequest
- In Chromium MV3, blocking `webRequest` is deprecated. Use `declarativeNetRequest` (static rulesets or `updateDynamicRules`) for network request filtering, header modification, and URL redirection.

---

## 2. Content Script Sandbox & DOM Isolation

### A. Shadow DOM & CSS Encapsulation
- **Zero Style Leakage**: Injected extension UI elements must never leak styles to the host page or inherit destructive host CSS (e.g. `* { box-sizing: border-box; }`, font overrides, CSS resets).
- **Shadow Root Architecture**: Mount injected overlays inside an open Shadow Root:
  - In **WXT**: Use `createShadowRootUi(ctx, { ... , cssInjectionMode: 'ui' })`.
  - In **Plasmo**: Leverage Plasmo's built-in Shadow DOM mounting container.
  - In **Vanilla React**: Use `container.attachShadow({ mode: 'open' })` with injected CSS `<style>` tag.

### B. Cross-Browser Asset URL Resolution
- Never hardcode relative asset paths (e.g. `<img src="/icon.png" />`) in content scripts.
- Always resolve paths dynamically using:
  ```typescript
  const iconUrl = typeof browser !== 'undefined' 
    ? browser.runtime.getURL('/icon.png') 
    : chrome.runtime.getURL('/icon.png');
  ```

### C. Isolated World vs Main World Execution
- **Default Isolation**: Keep 100% of extension logic in the **Isolated World** to prevent webpage scripts from tampering with extension variables.
- **Main World Bridges**: If interaction with host window objects is required (e.g., custom HTML5 video players or internal page globals), inject an isolated bridge script via `world: 'MAIN'` and communicate back via `window.postMessage` with strict origin and payload validation.

### D. Idempotent Injections
- Content scripts must verify whether a mount node already exists before appending a new instance to prevent duplicate overlays during client-side single-page app (SPA) route transitions.

---

## 3. Background Service Worker & Typed IPC

### A. Stateless Service Worker Lifecycle (Chromium MV3)
- Chromium MV3 background service workers terminate spontaneously after 30 seconds of inactivity.
- **State Management**:
  - Never rely on in-memory global variables to hold long-term state across user events.
  - Persist intermediate state in `chrome.storage.local`, `chrome.storage.sync`, or client-side IndexedDB.
  - Use `chrome.alarms` instead of long-running `setInterval` for recurring background tasks.

### B. Asynchronous Message Routing Compliance
- In `chrome.runtime.onMessage.addListener`, whenever the handler performs asynchronous work (Promises, async/await, API fetches), **it must return `true`** synchronously to keep the message channel open for `sendResponse`:
  ```typescript
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_DEFINITION') {
      handleFetch(message.payload).then(sendResponse);
      return true; // Mandatory for asynchronous response
    }
  });
  ```

### C. Type-Safe Discriminated Union IPC
- Define strict TypeScript contracts for all cross-context messages:
  ```typescript
  export type ExtensionMessage =
    | { type: 'ANALYZE_TEXT'; payload: { text: string } }
    | { type: 'SAVE_CARD'; payload: FlashcardData }
    | { type: 'GET_STORAGE'; key: string };
  ```

### D. CORS Bypass & Token Security
- Perform authenticated or third-party API requests inside the background service worker rather than inside content scripts. This mitigates host page Content Security Policy blocking and protects sensitive authentication tokens from page inspection.

---

## 4. Bundle Size Budgets & Tree-Shaking Optimization

### A. Strict Size Budgets
| Component | Maximum JS Size | Target Compression | Rationale |
| :--- | :--- | :--- | :--- |
| **Injected Content Script** | $< 400\text{ KB}$ | $< 120\text{ KB}$ (gzip) | Prevents DOM hitching and slow page rendering on host sites. |
| **Popup Action UI** | $< 800\text{ KB}$ | $< 250\text{ KB}$ (gzip) | Ensures instant popover open time ($< 100\text{ ms}$). |
| **Options / Dashboard Hub** | $< 2.5\text{ MB}$ | $< 700\text{ KB}$ (gzip) | Comprehensive management views loaded in dedicated tabs. |
| **Total Extension Package** | $< 15\text{ MB}$ | `.zip` archive | Faster downloads and seamless Chrome Web Store review. |

### B. Tree-Shaking Named Imports
- **Icon Libraries**: Never use wildcard imports (e.g. `import * as Icons from 'lucide-react'`). Use specific named imports (`import { Play, Volume2 } from 'lucide-react'`) and verify that bundlers do not include the full icon catalog.
- **Utilities**: Avoid bundling heavy utility suites (e.g. full `lodash`, `moment.js`). Prefer native JavaScript methods or modular alternatives (`date-fns`, `lodash-es`).

### C. Large Datasets & Dictionary Handling
- Never inline large JSON datasets, dictionary databases, or machine learning models directly into bundled JavaScript chunks.
- Store large static data in `public/` assets, loading on demand via IndexedDB or streaming chunks with dynamic `import()`.

### D. Dynamic Code Splitting (`React.lazy`)
- Split non-critical UI surfaces (settings tabs, import/export dialogs, stats charts) into separate chunks:
  ```tsx
  const AnalyticsView = React.lazy(() => import('~components/analytics-view'));
  ```

---

## 5. Memory Leak & Event Lifecycle Hygiene

### A. Event Listener Cleanup
- Every `addEventListener` mounted in content scripts, popups, or React components must have a corresponding teardown in `useEffect` cleanup returns:
  ```typescript
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { /* ... */ };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  ```

### B. Observers & Media Listeners
- Disconnect all `MutationObserver`, `ResizeObserver`, and `IntersectionObserver` instances on component unmount or URL change.
- Unbind media player listeners (`timeupdate`, `ratechange`, `play`, `pause`) when leaving video pages.

### C. Timer Teardowns
- Clear all `setTimeout` and `setInterval` timers in unmount lifecycles to prevent background zombie execution.

---

## 6. Storage Architecture & Local-First Privacy

| Storage Type | Capacity Limit | Best Used For | Persistence |
| :--- | :--- | :--- | :--- |
| **`chrome.storage.sync`** | 8KB per item / 100KB total | User preferences, theme, language settings | Cross-device browser sync |
| **`chrome.storage.local`** | 10MB (or unlimited with permission) | Cached metadata, recent history, UI state | Device-local |
| **`IndexedDB`** | Substantial ($> 50\text{MB}$) | Rich structured entities, offline dictionaries, flashcards | Local persistent database |

- **Zero Remote Backend Guardrail**: Ensure no private user data, learning history, or collected webpage text is transmitted to external servers without affirmative user opt-in and consent.

---

## 7. Content Security Policy (CSP) & Store Review Hygiene

### A. Zero Remote Executable Code
- Chromium MV3 strictly prohibits execution of remote code.
- **Banned Patterns**:
  - No `eval()`, `new Function()`, or `setTimeout("string", 100)`.
  - No loading scripts from external CDNs (e.g., `<script src="https://cdn.example.com/lib.js">`). All dependencies must be bundled locally into the extension package.
  - WebAssembly modules must be bundled locally and declared under `content_security_policy` if required.

### B. Chrome Web Store & Firefox AMO Compliance
- **Single Purpose Policy**: The extension title, description, and permission list must focus on a clear single purpose.
- **Privacy Policy Link**: Required whenever personal data, authentication tokens, or page content analysis occurs.

---

## 8. Audit Workflow & Execution Guide

When performing an extension audit, execute these diagnostic phases:

```
[1. Manifest & Config Scan] ──► [2. Bundle & Size Audit] ──► [3. Runtime & Sandboxing] ──► [4. Doctor Report]
- Validate MV3/MV2 schema       - Check chunk sizes (<400KB)   - Audit Shadow DOM & resets    - Output CLI Table
- Check host permissions        - Tree-shake verification      - Check async message returns   - Provide code fixes
- Check CSP & remote scripts    - Inspect bundle duplicates    - Check listener cleanups       - Prioritize P0/P1/P2
```

### Static Audit Inspection Commands
- Search for unescaped / uncleaned window listeners:
  ```bash
  grep -rn "addEventListener" --include="*.ts" --include="*.tsx" src/
  ```
- Search for forbidden `eval` or remote script execution:
  ```bash
  grep -rn "eval(" --include="*.ts" --include="*.tsx" src/
  ```
- Search for hardcoded asset paths:
  ```bash
  grep -rn "\"/assets/" --include="*.ts" --include="*.tsx" src/
  ```
- Analyze bundle build sizes:
  ```bash
  pnpm build
  ```

---

## 9. Standardized Audit Output Template (CLI Doctor Format)

Format all extension audit evaluations using this high-visibility, structured CLI Doctor format:

```markdown
# 🩺 Web Extension Doctor: [Extension / Component Name]

┌─────────────────────────────────────────────────────────────┐
│  Overall Status:  ✔ PASS (Compliant)  |  Health Score: 100% │
│  Passed: [Count]  Warnings: [Count]   |  Critical Fails: 0  │
└─────────────────────────────────────────────────────────────┘

---

### 1. Manifest & Permissions (MV3 / MV2)
- ✔ **PASS**  `Permission Minimization`
  - **Details**: Only `storage` and domain-specific host permissions declared.
  - **Location**: `wxt.config.ts#L12`

- ✔ **PASS**  `Web Accessible Resources Scoping`
  - **Details**: Assets restricted to specific target domains.
  - **Location**: `manifest.json`

### 2. Content Script Sandboxing & DOM
- ✔ **PASS**  `Shadow DOM Encapsulation`
  - **Details**: Injected overlay mounted with `cssInjectionMode: 'ui'` inside Shadow Root.
  - **Location**: `src/entrypoints/overlay.content/index.tsx#L18`

- ⚠ **WARN**  `Cross-Browser Asset Resolution`
  - **Details**: Found relative asset path in injected DOM.
  - **Location**: `src/components/badge.tsx#L42`
  - **Remediation**:
    ```tsx
    <img src={browser.runtime.getURL('/assets/badge.svg')} alt="Badge" />
    ```

### 3. Background Service Worker & IPC
- ✔ **PASS**  `Stateless Service Worker`
  - **Details**: Background state synced via `chrome.storage.local` and IndexedDB.
  - **Location**: `src/entrypoints/background.ts#L35`

- ✔ **PASS**  `Asynchronous Message Handling`
  - **Details**: Async message listeners return `true` synchronously.
  - **Location**: `src/entrypoints/background.ts#L88`

### 4. Bundle Size & Tree-Shaking
- ✔ **PASS**  `Content Script Size Budget`
  - **Details**: Content script bundled at 184 KB ($< 400\text{ KB}$ budget).
  - **Location**: `.output/chrome-mv3/content-scripts/`

- ✔ **PASS**  `Named Icon Tree-Shaking`
  - **Details**: Direct named imports used from `lucide-react`.
  - **Location**: `src/components/header.tsx#L3`

### 5. Memory Leak & Lifecycle Hygiene
- ✔ **PASS**  `Listener Cleanup`
  - **Details**: All `keydown` and video `timeupdate` listeners properly removed in `useEffect` returns.
  - **Location**: `src/contents/inline-dict.tsx#L65`

### 6. Security & CSP
- ✔ **PASS**  `Zero Remote Code Execution`
  - **Details**: Zero `eval()`, zero remote script tags, all packages bundled locally.

---

## 10. Remediation Priority Matrix
- 🔴 **CRITICAL (P0)**: Store rejection blockers (remote `eval()`, `<all_urls>` without justification, blocking message handlers not returning `true`, leaking un-encapsulated styles breaking host sites).
- 🟡 **WARNING (P1)**: Content scripts exceeding 400KB budget, un-cleaned event listeners causing memory leaks, relative asset paths failing in isolated worlds.
- 🟢 **INFO / PASS (P2)**: Best-practice optimizations, tree-shaking verifications, and cross-browser manifest parities.
