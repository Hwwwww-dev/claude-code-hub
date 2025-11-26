/**
 * Electron-specific Configuration Module
 *
 * Provides configuration utilities for the Electron desktop app mode.
 * This module handles:
 * - Data path resolution for PGlite database
 * - Config path resolution for app settings
 * - Persistent configuration storage (when electron-store available)
 *
 * Usage:
 * - In Electron main process: Full functionality with electron-store
 * - In Next.js/renderer: Path utilities only (store not available)
 */

import * as path from "path";
import { getEnvConfig } from "./env.schema";

/**
 * Electron configuration interface
 */
export interface ElectronConfig {
  /** Path to PGlite database directory */
  dataPath: string;
  /** Path to app configuration directory */
  configPath: string;
  /** App theme preference */
  theme: "light" | "dark" | "system";
  /** Enable automatic updates */
  autoUpdate: boolean;
  /** Server port for embedded Next.js server */
  serverPort: number;
}

/**
 * Default configuration values
 */
const defaults: ElectronConfig = {
  dataPath: "",
  configPath: "",
  theme: "system",
  autoUpdate: true,
  serverPort: 13500,
};

// Lazy-loaded electron-store instance
// Only available in Electron main process
let store: unknown = null;
let storeInitialized = false;

/**
 * Initialize electron-store if available.
 * This will only succeed in the Electron main process.
 */
function initStore(): unknown {
  if (storeInitialized) return store;
  storeInitialized = true;

  try {
    // Dynamic import to avoid bundling electron-store in web builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Store = require("electron-store");
    // Type cast since require returns any - electron-store handles the typing internally
    store = new Store({
      defaults,
      name: "config",
    });
  } catch {
    // electron-store not available (web build or renderer process)
    store = null;
  }

  return store;
}

/**
 * Get the Electron app object if available.
 * Returns undefined in non-Electron environments.
 */
function getElectronApp(): { getPath: (name: string) => string } | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron");
    return app;
  } catch {
    return undefined;
  }
}

/**
 * Get the PGlite database data path.
 *
 * Resolution order:
 * 1. PGLITE_DATA_PATH environment variable (highest priority)
 * 2. Electron userData directory + 'data/pglite'
 * 3. Current working directory + '.pglite' (development fallback)
 *
 * @returns Absolute path to PGlite data directory
 */
export function getDataPath(): string {
  // Environment variable takes highest priority
  const envPath = getEnvConfig().PGLITE_DATA_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }

  // In Electron, use userData directory
  const app = getElectronApp();
  if (app?.getPath) {
    try {
      return path.join(app.getPath("userData"), "data", "pglite");
    } catch {
      // getPath may fail if called too early
    }
  }

  // Fallback for development/testing
  return path.join(process.cwd(), ".pglite");
}

/**
 * Get the app configuration directory path.
 *
 * @returns Absolute path to configuration directory
 */
export function getConfigPath(): string {
  const app = getElectronApp();
  if (app?.getPath) {
    try {
      return app.getPath("userData");
    } catch {
      // getPath may fail if called too early
    }
  }
  return process.cwd();
}

/**
 * Get a configuration value from persistent storage.
 * Falls back to default value if store is not available.
 *
 * @param key Configuration key
 * @returns Configuration value
 */
export function getConfig<K extends keyof ElectronConfig>(key: K): ElectronConfig[K] {
  const s = initStore() as { get?: (key: K) => ElectronConfig[K] } | null;
  if (s?.get) {
    return s.get(key);
  }
  return defaults[key];
}

/**
 * Set a configuration value in persistent storage.
 * No-op if store is not available (web build or renderer process).
 *
 * @param key Configuration key
 * @param value Configuration value
 */
export function setConfig<K extends keyof ElectronConfig>(
  key: K,
  value: ElectronConfig[K],
): void {
  const s = initStore() as { set?: (key: K, value: ElectronConfig[K]) => void } | null;
  if (s?.set) {
    s.set(key, value);
  }
}

/**
 * Check if running in Electron mode.
 * Determined by ELECTRON_MODE environment variable.
 *
 * @returns true if ELECTRON_MODE is enabled
 */
export function isElectronMode(): boolean {
  return getEnvConfig().ELECTRON_MODE;
}

/**
 * Check if running in actual Electron environment.
 * Different from isElectronMode() - this checks for actual Electron runtime,
 * while isElectronMode() checks the configuration flag.
 *
 * @returns true if running in Electron
 */
export function isElectronRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.electron;
}

/**
 * Get all configuration values.
 * Useful for debugging or initial setup.
 *
 * @returns Complete configuration object
 */
export function getAllConfig(): ElectronConfig {
  return {
    dataPath: getDataPath(),
    configPath: getConfigPath(),
    theme: getConfig("theme"),
    autoUpdate: getConfig("autoUpdate"),
    serverPort: getConfig("serverPort"),
  };
}
