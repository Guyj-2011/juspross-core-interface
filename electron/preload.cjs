const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("jusprossDesktop", {
  isDesktop: true,
  platform: process.platform,
});
