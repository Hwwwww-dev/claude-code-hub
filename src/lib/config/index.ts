/**
 * 简化的配置管理模块
 */

export { getEnvConfig, isDevelopment, type EnvConfig } from "./env.schema";

export { config } from "./config";

// Electron-specific configuration utilities
export {
  getDataPath,
  getConfigPath,
  getConfig,
  setConfig,
  isElectronMode,
  isElectronRuntime,
  getAllConfig,
  type ElectronConfig,
} from "./electron-config";
