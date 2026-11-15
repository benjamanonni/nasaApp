import { defineConfig } from "vite";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api/v1": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
