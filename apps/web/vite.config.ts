import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const previewBranch = "codex/workkite-preview-toggle";

export default defineConfig({
  define: {
    "import.meta.env.VITE_PREVIEW_MODE": JSON.stringify(
      env.VERCEL_GIT_COMMIT_REF === previewBranch || env.VITE_PREVIEW_MODE === "true"
        ? "true"
        : "false",
    ),
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  preview: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
