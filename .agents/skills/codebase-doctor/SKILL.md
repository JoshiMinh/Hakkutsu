---
name: codebase-doctor
description: Automated codebase health diagnostics. Detects unused exports, dead code, orphan files, duplicate dependencies, circular module imports, and broken asset links.
---

# Codebase Doctor — Health & Dead Code Diagnostic

Use this skill when auditing codebase health, cleaning up dead code, checking module dependencies, or running pre-release diagnostic sweeps.

## Diagnostic Procedures

### 1. TypeScript & Dead Export Sweep
Run TypeScript validation and search for orphaned/unused symbols:
* Check for unused functions, interfaces, and types.
* Verify clean import paths and remove unreferenced dependencies.
* Identify circular dependencies (e.g. module A imports B which imports A).

### 2. Orphaned & Broken Asset Detection
* Scan references to static assets (`/assets/*`, icons, audio, json).
* Ensure every imported or referenced file exists on disk.
* Detect unreferenced or orphaned images/fonts taking up repository size.

### 3. Dependency Hygiene
* Verify `package.json` dependencies:
  * Check for duplicate or conflicting package versions.
  * Identify heavy packages that can be replaced with lightweight native equivalents.
  * Verify `devDependencies` vs `dependencies` separation.

### 4. Output Report Format
When running an audit, generate a structured diagnostic report:
* **Status Summary:** Pass / Fail / Warnings count.
* **Dead Code / Unused Exports:** List with file paths and line numbers.
* **Circular Dependencies:** List of import cycles.
* **Asset Integrity:** Verified vs missing asset paths.
* **Actionable Recommendations:** Ranked by priority.

