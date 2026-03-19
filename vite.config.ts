import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "app",
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../admin-dist/admin",
    emptyOutDir: true,
  },
});
