import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves project sites under /<repo>/. Override with VITE_BASE=/ for local preview.
const base = process.env.VITE_BASE ?? "/offline-lookout/";

// Real sizes of the assets the app streams on first load, so the progress ring is
// bytes received over bytes expected rather than a guess or a timer.
const require = createRequire(import.meta.url);
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const ASSET_BYTES = {
  wasm: statSync(require.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm")).size,
  model: statSync(here("./public/model/model_int8.onnx")).size,
  vocab: statSync(here("./public/model/vocab.txt")).size,
};

export default defineConfig({
  base,
  define: { __ASSET_BYTES__: JSON.stringify(ASSET_BYTES) },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  resolve: { dedupe: ["onnxruntime-web"] },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  worker: { format: "es" },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/*.png", "icons/*.svg", "fonts/*.woff2", "model/*"],
      workbox: {
        // The int8 model (~33 MB) and the ORT wasm runtime are precached so the
        // app is fully functional with the network off.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm,mjs,onnx,json,txt,ico}"],
        maximumFileSizeToCacheInBytes: 80 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "Offline Lookout",
        short_name: "Lookout",
        description: "On-device scam text detector. Nothing you paste ever leaves your phone.",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#0a0d13",
        theme_color: "#0a0d13",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Android: "Share" a message from another app straight into Lookout.
        share_target: {
          action: base,
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      } as any,
    }),
  ],
});
