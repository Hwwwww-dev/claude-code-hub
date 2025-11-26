import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const electronAPI: ElectronAPI = {
  // App information
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  getDataPath: () => ipcRenderer.invoke("get-data-path"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isDev: () => ipcRenderer.invoke("is-dev"),

  // Store operations
  getStoreValue: (key: string) => ipcRenderer.invoke("get-store-value", key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke("set-store-value", key, value),

  // External operations
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // Developer tools
  showDevTools: () => ipcRenderer.invoke("show-dev-tools"),

  // Server control
  restartServer: () => ipcRenderer.invoke("restart-server"),

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
