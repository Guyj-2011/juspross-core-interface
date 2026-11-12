const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jusprossDesktop", {
  isDesktop: true,
  platform: process.platform,
  connectSpotify: () => ipcRenderer.invoke("spotify:connect"),
});
