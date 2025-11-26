export interface ElectronAPI {
  // App information
  getAppVersion: () => Promise<string>;
  getUserDataPath: () => Promise<string>;
  getDataPath: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  isDev: () => Promise<boolean>;

  // Store operations
  getStoreValue: (key: string) => Promise<unknown>;
  setStoreValue: (key: string, value: unknown) => Promise<void>;

  // External operations
  openExternal: (url: string) => Promise<void>;

  // Developer tools
  showDevTools: () => Promise<void>;

  // Server control
  restartServer: () => Promise<void>;

  // Auto-update
  checkForUpdates: () => Promise<{ updateAvailable: boolean }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
