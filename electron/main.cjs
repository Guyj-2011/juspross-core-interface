const { app, BrowserWindow, shell, session, ipcMain } = require("electron");
const path = require("node:path");

const APP_URL = process.env.JUSPROSS_URL || "https://juspross.lovable.app";
const APP_ORIGIN = new URL(APP_URL).origin;
const SPOTIFY_ORIGIN = "https://accounts.spotify.com";

let mainWindow;
let spotifyAuthWindow;

function createSpotifyAuthWindow() {
  if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) {
    spotifyAuthWindow.focus();
    return;
  }

  spotifyAuthWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 620,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    title: "Conectar Spotify · Juspross",
    autoHideMenuBar: true,
    backgroundColor: "#050914",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // OAuth must use the same default session/cookies as the main Juspross window.
      backgroundThrottling: false,
    },
  });

  spotifyAuthWindow.once("ready-to-show", () => {
    if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) spotifyAuthWindow.show();
  });

  const isAllowedAuthUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === APP_ORIGIN || url.origin === SPOTIFY_ORIGIN;
    } catch {
      return false;
    }
  };

  spotifyAuthWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Keep the OAuth flow inside this window so its cookies remain shared with Juspross.
    return isAllowedAuthUrl(url) ? { action: "allow" } : { action: "deny" };
  });

  spotifyAuthWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAuthUrl(url)) event.preventDefault();
  });

  spotifyAuthWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedAuthUrl(url)) event.preventDefault();
  });

  const finishOAuthIfReturned = (url) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.origin === APP_ORIGIN &&
        parsed.pathname === "/" &&
        ["connected", "denied", "token-error", "state-error", "not-configured"].includes(
          parsed.searchParams.get("spotify") || "",
        )
      ) {
        // The callback response has already set the shared HttpOnly cookie.
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
        if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) spotifyAuthWindow.close();
      }
    } catch {
      // Ignore non-URL navigation events.
    }
  };

  spotifyAuthWindow.webContents.on("did-navigate", (_event, url) => finishOAuthIfReturned(url));
  spotifyAuthWindow.webContents.on("did-navigate-in-page", (_event, url) => finishOAuthIfReturned(url));

  spotifyAuthWindow.on("closed", () => {
    spotifyAuthWindow = null;
  });

  spotifyAuthWindow.loadURL(new URL("/api/spotify/connect", APP_URL).toString());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Juspross",
    backgroundColor: "#050914",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep speech playback and app activity running when another window is focused.
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) spotifyAuthWindow.close();
  });

  mainWindow.loadURL(APP_URL);
}

ipcMain.handle("spotify:connect", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("La ventana de Juspross no está disponible.");
  }
  createSpotifyAuthWindow();
  return { ok: true };
});

app.whenReady().then(() => {
  const appSession = session.defaultSession;

  // Request microphone access only for the trusted Juspross origin.
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents?.getURL() || "";
    let trustedOrigin = false;
    try {
      trustedOrigin = new URL(requestingUrl).origin === APP_ORIGIN;
    } catch {
      trustedOrigin = false;
    }
    callback(permission === "media" && trustedOrigin);
  });

  appSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "media" && requestingOrigin === APP_ORIGIN;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
