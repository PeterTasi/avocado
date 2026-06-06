import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // VITE_BASE_PATH: set to "/repo-name/" for GitHub project pages, or "/" for user pages.
  // When serving via FastAPI static mount the default "/static/" is correct.
  base: process.env.VITE_BASE_PATH ?? "/static/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../static",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          icons: ["lucide-react"],
          query: ["@tanstack/react-query"],
        },
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    chunkSizeWarningLimit: 250,
    sourcemap: false,
    minify: "esbuild",
  },
  optimizeDeps: {
    include: ["react", "react-dom", "recharts", "lucide-react", "@tanstack/react-query"],
  },
});
