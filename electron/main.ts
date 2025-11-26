import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import http from "http";
import log from "electron-log";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";

// Configure electron-log
log.transports.file.level = "info";
autoUpdater.logger = log;

// Configuration
const PORT = process.env.PORT || 13500;
const isDev = process.env.NODE_ENV === "development";
const SERVER_READY_TIMEOUT = 30000; // 30 seconds

// Store schema type definition
interface StoreSchema {
  windowBounds: { width: number; height: number };
  lastUrl: string;
}

// Persistent store for app settings
const store = new Store<StoreSchema>({
  name: "claude-code-hub-config",
  defaults: {
    windowBounds: { width: 1400, height: 900 },
    lastUrl: "/",
  },
});

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let isQuitting = false;

// Request single instance lock to prevent multiple app instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info("[Main] Another instance is already running, quitting...");
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus the main window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Get PGlite data path
function getPGliteDataPath(): string {
  return path.join(app.getPath("userData"), "data", "pglite");
}

// Get server path based on environment
function getServerPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "node_modules", ".bin", "next");
  }
  return path.join(process.resourcesPath, "server");
}

// Wait for server to be ready using HTTP health check
async function waitForServer(port: number, timeout: number): Promise<boolean> {
  const startTime = Date.now();
  const healthEndpoints = ["/api/health", "/"];

  while (Date.now() - startTime < timeout) {
    for (const endpoint of healthEndpoints) {
      try {
        const ready = await new Promise<boolean>((resolve) => {
          const req = http.get(`http://localhost:${port}${endpoint}`, (res) => {
            // Accept 200-399 status codes as healthy
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
          req.on("error", () => resolve(false));
          req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
          });
        });

        if (ready) {
          log.info(`[Main] Server ready at http://localhost:${port}${endpoint}`);
          return true;
        }
      } catch {
        // Continue to next attempt
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function createWindow(): void {
  const { width, height } = store.get("windowBounds") as { width: number; height: number };

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    backgroundColor: "#0a0a0a",
  });

  // Load the app URL
  const startUrl = `http://localhost:${PORT}`;
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
  });

  // Save window bounds on resize
  mainWindow.on("resize", () => {
    if (mainWindow) {
      const { width, height } = mainWindow.getBounds();
      store.set("windowBounds", { width, height });
    }
  });

  // Handle window close
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("https://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle navigation
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

async function startNextServer(): Promise<void> {
  if (isDev) {
    // In dev mode, assume Next.js dev server is already running via concurrently
    log.info("[Main] Development mode: expecting Next.js dev server on port", PORT);
    const ready = await waitForServer(Number(PORT), SERVER_READY_TIMEOUT);
    if (!ready) {
      throw new Error(`Next.js dev server not available at port ${PORT}. Run: bun run dev`);
    }
    return;
  }

  // Production: Start standalone server
  const serverPath = getServerPath();
  const serverScript = path.join(serverPath, "server.js");

  log.info("[Main] Starting production server from:", serverScript);
  log.info("[Main] PGlite data path:", getPGliteDataPath());

  return new Promise<void>((resolve, reject) => {
    serverProcess = spawn("node", [serverScript], {
      env: {
        ...process.env,
        PORT: String(PORT),
        HOSTNAME: "localhost",
        ELECTRON_MODE: "true",
        PGLITE_DATA_PATH: getPGliteDataPath(),
      },
      stdio: ["ignore", "pipe", "pipe"],
      cwd: serverPath,
    });

    let resolved = false;

    const handleReady = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    serverProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        log.info("[Server]", output);
      }
      // Check for Next.js ready messages
      if (
        output.includes("Ready") ||
        output.includes("started server") ||
        output.includes("Listening")
      ) {
        handleReady();
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        log.error("[Server Error]", output);
      }
    });

    serverProcess.on("error", (err: Error) => {
      log.error("[Main] Failed to start server process:", err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    serverProcess.on("exit", (code: number | null) => {
      log.info(`[Main] Server process exited with code ${code}`);
      if (!resolved && code !== 0 && code !== null) {
        resolved = true;
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Fallback: Wait for HTTP health check with timeout
    setTimeout(async () => {
      if (!resolved) {
        const ready = await waitForServer(Number(PORT), SERVER_READY_TIMEOUT);
        if (ready) {
          handleReady();
        } else {
          resolved = true;
          reject(new Error("Server did not become ready within timeout"));
        }
      }
    }, 2000);
  });
}

// Stop server gracefully
async function stopServer(): Promise<void> {
  const proc = serverProcess;
  if (!proc) {
    return;
  }

  log.info("[Main] Stopping server gracefully...");

  return new Promise<void>((resolve) => {
    const gracefulTimeout = setTimeout(() => {
      log.warn("[Main] Server did not stop gracefully, forcing kill");
      proc.kill("SIGKILL");
      serverProcess = null;
      resolve();
    }, 5000);

    proc.once("exit", () => {
      clearTimeout(gracefulTimeout);
      log.info("[Main] Server stopped");
      serverProcess = null;
      resolve();
    });

    // Send graceful shutdown signal
    proc.kill("SIGTERM");
  });
}

// Restart the server (for IPC call)
async function restartServer(): Promise<void> {
  log.info("[Main] Restarting server...");
  await stopServer();
  await startNextServer();
  log.info("[Main] Server restarted successfully");
}

function setupAutoUpdater(): void {
  if (isDev) {
    log.info("Skipping auto-updater in development mode");
    return;
  }

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-available", () => {
    log.info("Update available");
  });

  autoUpdater.on("update-downloaded", () => {
    log.info("Update downloaded");
  });

  autoUpdater.on("error", (err) => {
    log.error("Auto-updater error:", err);
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // App information
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-user-data-path", () => app.getPath("userData"));
  ipcMain.handle("get-data-path", () => path.join(app.getPath("userData"), "data"));
  ipcMain.handle("get-platform", () => process.platform);
  ipcMain.handle("is-dev", () => isDev);

  // Store operations
  ipcMain.handle("get-store-value", (_event, key: string) => store.get(key));
  ipcMain.handle("set-store-value", (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  // External operations
  ipcMain.handle("open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Developer tools
  ipcMain.handle("show-dev-tools", () => {
    mainWindow?.webContents.openDevTools({ mode: "detach" });
  });

  // Server control
  ipcMain.handle("restart-server", async () => {
    await restartServer();
  });

  // Auto-update
  ipcMain.handle("check-for-updates", async () => {
    if (isDev) return { updateAvailable: false };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { updateAvailable: !!result?.updateInfo };
    } catch {
      return { updateAvailable: false };
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  log.info("[Main] App ready, initializing...");
  log.info("[Main] App version:", app.getVersion());
  log.info("[Main] Electron version:", process.versions.electron);
  log.info("[Main] Platform:", process.platform);
  log.info("[Main] Development mode:", isDev);
  log.info("[Main] User data path:", app.getPath("userData"));

  setupIpcHandlers();

  try {
    await startNextServer();
    log.info("[Main] Server started successfully");
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    log.error("[Main] Failed to start application:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    isQuitting = true;
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    await stopServer();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("quit", () => {
  log.info("[Main] Application quit");
});

// Security: Prevent new window creation
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
});

export { mainWindow, store };
