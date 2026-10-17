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
  onBox: (cb) => {
    const h = (_e, box) => cb(box);
    ipcRenderer.on("overlay:box", h);
    return () => ipcRenderer.removeListener("overlay:box", h);
  },
  ready: () => ipcRenderer.send("overlay:ready"),
  fitWidth: (w) => ipcRenderer.send("overlay:fit-width", Number(w)),
  resize: (w, h, done) => ipcRenderer.send("overlay:resize", { w: Number(w), h: Number(h), done: !!done }),
});
