import { defineConfig } from "wxt";
import path from "node:path";
import { readFileSync } from "node:fs";

const tesseractAsset = (fileName: string) =>
  path.resolve(__dirname, "node_modules/tesseract.js-core", fileName);

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  publicDir: "../public",
  alias: {
    "~components": path.resolve(__dirname, "src/components"),
    "~lib": path.resolve(__dirname, "src/lib"),
    "~contents": path.resolve(__dirname, "src/contents"),
    "~style.css": path.resolve(__dirname, "src/style.css"),
    "~": path.resolve(__dirname, "src"),
  },
  vite: () => ({
    esbuild: {
      jsx: "automatic",
    },
    plugins: [
      {
        name: "hakkutsu-local-tesseract-assets",
        apply: "build",
        buildStart() {
          const assets = [
            {
              fileName: "ocr/worker.min.js",
              sourcePath: path.resolve(__dirname, "node_modules/tesseract.js/dist/worker.min.js"),
            },
            {
              fileName: "ocr/tesseract-core-simd-lstm.js",
              sourcePath: tesseractAsset("tesseract-core-simd-lstm.js"),
            },
            {
              fileName: "ocr/tesseract-core-simd-lstm.wasm",
              sourcePath: tesseractAsset("tesseract-core-simd-lstm.wasm"),
            },
          ];

          for (const asset of assets) {
            this.emitFile({
              type: "asset",
              fileName: asset.fileName,
              source: readFileSync(asset.sourcePath),
            });
          }
        },
      },
    ],
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  }),
  manifest: {
    name: "Hakkutsu — Japanese Immersion",
    description: "Local-first open-source Japanese immersion extension with offline dictionary, Kuromoji parsing, SRS, and dual subtitles.",
    version: "2.1.0",
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
      "512": "icon-512.png"
    },
    action: {
      default_title: "Hakkutsu",
      default_popup: "popup.html",
      default_icon: {
        "16": "icon-16.png",
        "32": "icon-32.png",
        "48": "icon-48.png",
        "128": "icon-128.png"
      }
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    permissions: [
      "scripting",
      "tabs",
      "storage",
      "activeTab",
      "contextMenus"
    ],
    commands: {
      "trigger-box-ocr": {
        suggested_key: {
          default: "Alt+S",
          mac: "Alt+S"
        },
        description: "Trigger Hakkutsu Box OCR selection on the current page"
      }
    },
    host_permissions: [
      "https://*/*",
      "http://localhost:3000/*",
      "http://localhost:8000/*",
      "http://127.0.0.1:8000/*",
      "http://localhost:8765/*"
    ],
    web_accessible_resources: [
      {
        resources: [
          "assets/*",
          "ocr/*",
          "icon-16.png",
          "icon-32.png",
          "icon-48.png",
          "icon-128.png",
          "icon-512.png",
          "content-scripts/youtube-bridge.js",
          "content-scripts/netflix-bridge.js"
        ],
        matches: ["<all_urls>"]
      }
    ]
  }
});
