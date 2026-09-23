import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the same build works at a domain root, under a
// GitHub Pages sub-path (/ScanOnce/), or from a local folder.
export default defineConfig({
  base: "./",
  build: { target: "es2020", chunkSizeWarningLimit: 4000 },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "ScanOnce",
        short_name: "ScanOnce",
        description: "Scan, convert, compress, OCR, protect and organize PDFs. Files never leave your device.",
        theme_color: "#0f5b54",
        background_color: "#f6f5f1",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,wasm,ttf,bcmap,pfb}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tesseract OCR engine and language data are fetched on first OCR use,
            // then kept so OCR also works offline afterwards.
            urlPattern: ({ url }) =>
              url.hostname === "cdn.jsdelivr.net" || url.hostname === "tessdata.projectnaptha.com",
            handler: "CacheFirst",
            options: {
              cacheName: "ocr-assets",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  test: { environment: "node", testTimeout: 60000 }
} as any);
