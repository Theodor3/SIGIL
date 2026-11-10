import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": "http://localhost:8000",
      "/health": "http://localhost:8000",
      // useWebSocket connects to /ws on the page's own host, so the dev server
      // has to forward the upgrade to the backend like it does /api.
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
