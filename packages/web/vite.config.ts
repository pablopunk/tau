import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.TAU_API ?? "http://127.0.0.1:4317";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: API_TARGET,
        ws: true,
        changeOrigin: true,
        configure(proxy) {
          const setBackendOrigin = (request: { setHeader(name: string, value: string): void }) => {
            const { origin } = new URL(API_TARGET);
            request.setHeader("origin", origin);
          };
          proxy.on("proxyReq", setBackendOrigin);
          proxy.on("proxyReqWs", setBackendOrigin);
        },
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
