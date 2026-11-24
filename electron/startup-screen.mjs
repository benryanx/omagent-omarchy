import { fileURLToPath } from 'node:url';

export function startupScreenHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>OMAGENT Startup</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
  body{color:#f3f2ed;font-family:system-ui,sans-serif;-webkit-app-region:drag;user-select:none}
  main{height:100%;display:grid;place-items:center;background:transparent}
  h1{margin:0;padding-left:.36em;font-size:28px;font-weight:500;line-height:1;letter-spacing:.36em;text-shadow:0 1px 14px #0009;animation:breathe 2.8s ease-in-out infinite}
  .status{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  @keyframes breathe{0%,100%{opacity:.68}50%{opacity:1}}
  @media(prefers-reduced-motion:reduce){h1{animation:none}}
  </style></head><body><main aria-busy="true" aria-describedby="startup-status"><h1>OMAGENT</h1><span id="startup-status" class="status" role="status" aria-live="polite">Opening your workspace…</span></main><script>document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();window.startupScreen.close()}})</script></body></html>`;
}

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit,
  onHide, isHidden = () => false, onShow, onFinished,
}) {
  let disposed = false, revealed = false, fallback, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: 340, height: 100, resizable: false, maximizable: false,
    fullscreenable: false, frame: false, transparent: true, hasShadow: false,
    skipTaskbar: true, type: platform === "linux" ? "splash" : undefined,
    backgroundColor: "#00000000", show: false, icon: iconPath,
    title: "OMAGENT Startup", autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: fileURLToPath(new URL("./startup-screen-preload.cjs", import.meta.url)),
    },
  });
  splash.setMenu(null);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fallback);
    resolveReady();
    if (!splash.isDestroyed()) splash.destroy();
    onFinished?.();
  };
  splash.on("close", event => {
    if (disposed || isQuitting()) return;
    event.preventDefault();
    if (platform === "win32" && onHide) onHide(splash);
    else onQuit();
  });
  // Renderer window.close() bypasses BrowserWindow's cancellable close path, so the page asks for the native one.
  splash.webContents.on("ipc-message", (_event, channel) => {
    if (channel === "startup-screen:close" && !disposed) splash.close();
  });
  let shown = false;
  const showSplash = () => {
    if (shown || disposed || isQuitting()) return;
    shown = true; splash.show(); resolveReady();
  };
  splash.once("ready-to-show", showSplash);
  // Some Wayland compositors (COSMIC) never paint a hidden window, so ready-to-show never comes.
  splash.webContents.once("did-finish-load", () => {
    const grace = setTimeout(showSplash, 500);
    grace.unref?.();
  });
  splash.on("show", () => onShow?.(splash));
  splash.once("closed", resolveReady);
  // The splash stays until the main window replaces it: as the only window, destroying it would quit the app.
  splash.webContents.once("render-process-gone", resolveReady);
  let said = null;
  const say = () => {
    if (said === null || disposed || splash.isDestroyed()) return;
    void splash.webContents.executeJavaScript(`(() => { const line = document.querySelector('.status'); if (line?.lastChild) line.lastChild.textContent = ${JSON.stringify(said)}; })()`).catch(() => {});
  };
  splash.webContents.on("did-finish-load", say);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml()))
    .catch(resolveReady);
  const attach = (win, { maximized = false } = {}) => {
    const reveal = () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      revealed = true;
      const minimized = !splash.isDestroyed() && splash.isMinimized();
      if (isHidden()) {
        win.setSkipTaskbar(true);
        win.hide();
        if (maximized) win.once("show", () => win.maximize());
      } else {
        if (maximized) win.maximize();
        if (minimized) { win.showInactive(); win.minimize(); }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    win.webContents.on("did-finish-load", () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      void win.webContents.executeJavaScript(`new Promise(resolve => {
        const root = document.getElementById('root');
        if (!root || root.childElementCount) { resolve(); return; }
        const observer = new MutationObserver(() => {
          if (root.childElementCount) { observer.disconnect(); resolve(); }
        });
        observer.observe(root, { childList: true });
      })`).then(reveal).catch(reveal);
    });
    win.webContents.once("render-process-gone", reveal);
    win.once("show", () => { if (!revealed) { revealed = true; dispose(); } });
    win.once("closed", dispose);
    fallback = setTimeout(reveal, 10_000);
    fallback.unref?.();
  };
  /** Accessible progress description; the visible wordmark stays unchanged. */
  const status = (text) => { said = String(text); say(); };
  return { ready, attach, dispose, status, window: splash };
}
