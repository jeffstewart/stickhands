import { defineConfig } from "vite";

// Relative base so the built index.html (and everything it references —
// the module script, favicon.svg, logo.svg) resolves correctly under a
// file:// load, not just when served from an HTTP origin's root. Needed for
// the Electron desktop wrapper, which loads dist/index.html directly off
// disk rather than through a dev server. Doesn't affect `vite`/`vite preview`
// (those serve from an actual origin, where root-absolute paths already
// resolve fine) — only changes what `vite build` emits.
export default defineConfig({
  base: "./",
});
