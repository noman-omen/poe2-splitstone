"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("splitstoneOverlay", {
  onState: (cb) => {
    const h = (_e, st) => cb(st);
    ipcRenderer.on("overlay:state", h);
    return () => ipcRenderer.removeListener("overlay:state", h);
  },
  ready: () => ipcRenderer.send("overlay:ready"),
});
