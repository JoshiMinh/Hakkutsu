import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "~": path.resolve(__dirname, "../src") } },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
