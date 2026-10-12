/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Byte sizes of the downloaded assets, measured from disk at build time (see vite.config.ts). */
declare const __ASSET_BYTES__: { wasm: number; model: number; vocab: number };

declare module "onnxruntime-web/ort-wasm-simd-threaded.wasm?url" {
  const url: string;
  export default url;
}
