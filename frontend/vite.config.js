import { URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

function validateProductionApiUrl(baseUrl) {
  const url = URL.parse(baseUrl);
  if (
    !/^https:\/\/[^/?#\\\s]+\/api\/v1\/?$/.test(baseUrl) ||
    !url ||
    url.username ||
    url.password ||
    /(^|\.)localhost\.?$|^127\.|^0\.0\.0\.0$|^\[::1\]$/.test(url.hostname)
  ) {
    throw new Error(
      "Configurá VITE_API_BASE_URL con la URL pública HTTPS de Render seguida de /api/v1 para compilar AgroDSS.",
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const env = loadEnv(mode, import.meta.dirname, "VITE_API_BASE_URL");
    validateProductionApiUrl(env.VITE_API_BASE_URL?.trim() ?? "");
  }

  return {
    oxc: { jsx: { runtime: "automatic" } },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api/v1": { target: "http://127.0.0.1:8000", changeOrigin: true } },
    },
  };
});
