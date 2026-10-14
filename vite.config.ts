import { defineConfig, loadEnv } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Allow Coolify to inject STARBELT_* / EVOLUTION_* without VITE_ prefix (build-time).
  const map: Record<string, string> = {};
  if (env.EVOLUTION_BASE_URL && !env.VITE_EVOLUTION_BASE_URL) {
    map["import.meta.env.VITE_EVOLUTION_BASE_URL"] = JSON.stringify(env.EVOLUTION_BASE_URL);
  }
  if (env.STARBELT_API_KEY && !env.VITE_STARBELT_API_KEY) {
    map["import.meta.env.VITE_STARBELT_API_KEY"] = JSON.stringify(env.STARBELT_API_KEY);
  }
  if (env.STARBELT_INSTANCE && !env.VITE_STARBELT_INSTANCE) {
    map["import.meta.env.VITE_STARBELT_INSTANCE"] = JSON.stringify(env.STARBELT_INSTANCE);
  }
  return {
    plugins: [preact()],
    base: "./",
    define: map,
    build: {
      target: "es2022",
      assetsInlineLimit: 0,
    },
    server: {
      port: 5173,
      strictPort: false,
    },
  };
});
