// Minimal Electron main process — this app needs nothing from Electron
// beyond a window. MIDI works via Chromium's built-in Web MIDI (the whole
// reason this is Electron and not Tauri: Tauri wraps each OS's system
// webview, and WebKit — Safari, WKWebView on Mac, WebKitGTK on Linux — has
// never implemented Web MIDI and has no roadmap to; Electron bundles its own
// Chromium regardless of host OS, so it just works everywhere). Audio via
// Web Audio, persistence via localStorage — both already work automatically
// under a BrowserWindow's own persistent storage partition. No preload, no
// IPC: there's no native surface this app needs bridged to the renderer.
//
// Plain CommonJS (.cjs) rather than TypeScript or ESM, on purpose — matches
// this repo's existing convention that build/infra tooling (tools/*.mjs)
// stays plain JS rather than adopting a new compiled-main-process pattern
// for a file this small, and sidesteps Electron's ESM-main-process edge
// cases (dynamic-import timing around app.whenReady(), sandboxed-preload
// restrictions in some versions) entirely.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

// Set via `npm run electron` (see package.json) while `npm run dev` is
// running in another terminal — points at the Vite dev server instead of
// the built dist/ output, for hot-reload during development. Unset (the
// packaged-app path) loads the built index.html straight off disk, which is
// exactly why vite.config.ts sets `base: "./"` — a file:// load needs
// relative asset paths, not the root-absolute ones a browser-served build
// would use.
const devServerUrl = process.env.ELECTRON_DEV ? "http://localhost:5173" : null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    title: "Stickhands",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devServerUrl) win.loadURL(devServerUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  // macOS convention: clicking the dock icon with no windows open should
  // reopen one, rather than doing nothing until the user relaunches.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS convention: apps stay running (in the dock, no window) after the
// last window closes, unlike Windows/Linux where closing the last window
// means quitting.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
