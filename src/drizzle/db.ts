/**
 * Database Connection Module
 *
 * Supports two modes:
 * 1. Server Mode (default): Uses PostgreSQL via postgres-js
 *    - Requires DSN environment variable
 *    - Uses 'server-only' to prevent client-side imports
 *
 * 2. Electron Mode: Uses PGlite (embedded PostgreSQL)
 *    - Enabled by ELECTRON_MODE=true
 *    - Uses async initialization via getDbAsync()
 *    - Data stored in PGLITE_DATA_PATH or ./.pglite
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import * as schema from './schema';

// Check if running in Electron mode
const isElectronMode = process.env.ELECTRON_MODE === 'true';

// Conditionally import server-only (skip in Electron mode)
// In server mode, this prevents accidental client-side imports
// In Electron mode, we skip this check to allow renderer process usage
if (!isElectronMode) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('server-only');
}

// Type definitions for both database backends
type PostgresDatabase = PostgresJsDatabase<typeof schema>;
type PGLiteDb = PgliteDatabase<typeof schema>;
export type Database = PostgresDatabase | PGLiteDb;

// Singleton instances
let postgresDbInstance: PostgresDatabase | null = null;
let pgliteDbInstance: PGLiteDb | null = null;

/**
 * Create PostgreSQL database instance (server mode)
 */
function createPostgresDbInstance(): PostgresDatabase {
  const connectionString = process.env.DSN;

  if (!connectionString) {
    throw new Error('DSN environment variable is not set');
  }

  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

/**
 * Get database instance synchronously (server mode only).
 * In Electron mode, this will throw an error - use getDbAsync() instead.
 *
 * @throws Error if called in Electron mode
 * @returns PostgresDatabase instance
 */
export function getDb(): PostgresDatabase {
  if (isElectronMode) {
    throw new Error(
      '[DB] getDb() is not available in Electron mode. Use getDbAsync() instead.',
    );
  }

  if (!postgresDbInstance) {
    postgresDbInstance = createPostgresDbInstance();
  }

  return postgresDbInstance;
}

/**
 * Get database instance asynchronously (works in both modes).
 * This is the recommended way to access the database in code that
 * needs to support both server and Electron modes.
 *
 * @returns Promise<Database> - Database instance
 */
export async function getDbAsync(): Promise<Database> {
  if (isElectronMode) {
    if (!pgliteDbInstance) {
      // Dynamic import to avoid bundling PGlite in server builds
      const { getPGliteDb } = await import('./pglite-db');
      pgliteDbInstance = await getPGliteDb();
    }
    return pgliteDbInstance;
  }

  // Server mode - return PostgreSQL instance
  return getDb();
}

/**
 * Close database connections (mainly for Electron mode cleanup).
 * Should be called when the application is shutting down.
 */
export async function closeDb(): Promise<void> {
  if (isElectronMode && pgliteDbInstance) {
    const { closePGliteDb } = await import('./pglite-db');
    await closePGliteDb();
    pgliteDbInstance = null;
  }
  // PostgreSQL connections are managed by the postgres-js pool
}

/**
 * Synchronous database proxy (server mode only).
 * This maintains backward compatibility with existing code that uses `db` directly.
 *
 * WARNING: This proxy will throw an error if accessed in Electron mode.
 * For Electron-compatible code, use getDbAsync() instead.
 */
export const db = new Proxy({} as PostgresDatabase, {
  get(_target, prop, receiver) {
    if (isElectronMode) {
      throw new Error(
        `[DB] Synchronous 'db' access is not available in Electron mode. ` +
          `Use 'getDbAsync()' instead. Attempted to access: ${String(prop)}`,
      );
    }
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);

    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

/**
 * Check if running in Electron mode
 */
export function isElectron(): boolean {
  return isElectronMode;
}
