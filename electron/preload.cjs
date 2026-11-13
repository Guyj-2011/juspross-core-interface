const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jusprossDesktop", {
  isDesktop: true,
  platform: process.platform,
  connectSpotify: () => ipcRenderer.invoke("spotify:connect"),
  captureScreenFrame: () => ipcRenderer.invoke("screen:capture-frame"),
});
