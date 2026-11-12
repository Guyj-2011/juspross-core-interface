const { app, BrowserWindow, shell, session } = require("electron");
const path = require("node:path");

const APP_URL = process.env.JUSPROSS_URL || "https://juspross.lovable.app";
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow;

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
  });

  mainWindow.loadURL(APP_URL);
}

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
