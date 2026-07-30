import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:8200",
        changeOrigin: true
      },
      "/ws": {
        target: (process.env.VITE_BACKEND_URL ?? "http://localhost:8200").replace(/^http/, "ws"),
        ws: true
      }
    }
  }
});
