import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ["**/.vs/**", "**/node_modules/**"] },
    proxy: { "/api": "http://localhost:3001" }
  }
});
