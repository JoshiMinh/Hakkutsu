import { defineConfig } from "wxt";
import path from "node:path";

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
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  }),
  manifest: {
    name: "Hakkutsu — Japanese Immersion",
    description: "Local-first open-source Japanese immersion extension with offline dictionary, Kuromoji parsing, SRS, and dual subtitles.",
    version: "2.0.0",
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
    permissions: [
      "scripting",
      "tabs",
      "storage",
      "activeTab",
      "contextMenus",
      "offscreen"
    ],
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
