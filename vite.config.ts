import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Each tool is its own page, served by the toolkit's server from dist/web.
export default defineConfig({
  root: resolve(__dirname, "src/web"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        control: resolve(__dirname, "src/web/control.html"),
        map: resolve(__dirname, "src/web/map.html"),
      },
    },
  },
});
