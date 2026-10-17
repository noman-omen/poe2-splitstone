"use strict";
/**
 * Minimal preload bridge for the main Splitstone window.
 * No Node integration in the renderer — only this allowlisted API.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splitstoneDesktop", {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  setClientLog: (filePath) => ipcRenderer.invoke("desktop:set-client-log", filePath),
  browseClientLog: () => ipcRenderer.invoke("desktop:browse-client-log"),
  findClientLog: () => ipcRenderer.invoke("desktop:find-client-log"),
  setHotkeys: (bindings) => ipcRenderer.invoke("desktop:set-hotkeys", bindings),
  setOverlayEnabled: (on) => ipcRenderer.invoke("desktop:set-overlay", !!on),
  setOverlayOpacity: (n) => ipcRenderer.invoke("desktop:set-overlay-opacity", n),
  setOverlayTextSize: (size) => ipcRenderer.invoke("desktop:set-overlay-text-size", String(size)),
  setAutoUpdate: (on) => ipcRenderer.invoke("desktop:set-auto-update", !!on),
  setClickThrough: (on) => ipcRenderer.invoke("desktop:set-click-through", !!on),
  resetOverlayPosition: () => ipcRenderer.invoke("desktop:reset-overlay-position"),
  getAutoUpdate: () => ipcRenderer.invoke("desktop:get-auto-update"),
  pushOverlayState: (snapshot) => ipcRenderer.send("desktop:overlay-state", snapshot),
  onZone: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on("desktop:zone", handler);
    return () => ipcRenderer.removeListener("desktop:zone", handler);
  },
  onHotkey: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on("desktop:hotkey", handler);
    return () => ipcRenderer.removeListener("desktop:hotkey", handler);
  },
  onStatus: (cb) => {
    const handler = (_e, st) => cb(st);
    ipcRenderer.on("desktop:status", handler);
    return () => ipcRenderer.removeListener("desktop:status", handler);
  },
  onToast: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("desktop:toast", handler);
    return () => ipcRenderer.removeListener("desktop:toast", handler);
  },
  onFirstRunNeeded: (cb) => {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on("desktop:first-run", handler);
    return () => ipcRenderer.removeListener("desktop:first-run", handler);
  },
  focusMain: () => ipcRenderer.send("desktop:focus-main"),
  dismissFirstRun: () => ipcRenderer.invoke("desktop:dismiss-first-run"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
});
