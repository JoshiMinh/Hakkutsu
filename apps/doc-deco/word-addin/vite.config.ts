import { defineConfig } from "vite";
import devCerts from "office-addin-dev-certs";

export default defineConfig(async () => ({
  server: {
    port: 3000,
    https: await devCerts.getHttpsServerOptions(),
    proxy: {
      "/api/docdeco": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true
      }
    }
  }
}));

