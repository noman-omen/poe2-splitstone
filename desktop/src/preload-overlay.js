"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("splitstoneOverlay", {
  onState: (cb) => {
    const h = (_e, st) => cb(st);
    ipcRenderer.on("overlay:state", h);
    return () => ipcRenderer.removeListener("overlay:state", h);
  },
  onLock: (cb) => {
    const h = (_e, locked) => cb(locked);
    ipcRenderer.on("overlay:lock", h);
    return () => ipcRenderer.removeListener("overlay:lock", h);
  },
  onToast: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on("overlay:toast", h);
    return () => ipcRenderer.removeListener("overlay:toast", h);
  },
  ready: () => ipcRenderer.send("overlay:ready"),
  resize: (w, h) => ipcRenderer.send("overlay:resize", { w, h }),
});
