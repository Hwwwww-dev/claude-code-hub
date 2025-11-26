/**
 * PGlite Database Connection for Electron Desktop Mode
 *
 * This module provides an embedded PostgreSQL database using PGlite (WASM-based).
 * It's designed for the Electron desktop app where a full PostgreSQL server
 * is not available.
 *
 * Usage:
 * - Set ELECTRON_MODE=true to enable PGlite
 * - Set PGLITE_DATA_PATH to customize the data directory (optional)
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';

// Database instance singleton
let pgliteDb: PgliteDatabase<typeof schema> | null = null;
let pgliteClient: PGlite | null = null;

/**
 * Get the PGlite data directory path.
 * In Electron, this should be set to app.getPath('userData')/pglite
 * For development/testing, uses a local .pglite directory
 */
function getDataPath(): string {
  // Environment variable takes precedence (set by Electron main process)
  if (process.env.PGLITE_DATA_PATH) {
    return process.env.PGLITE_DATA_PATH;
  }

  // Default path for development/testing
  // In production Electron, PGLITE_DATA_PATH should always be set
  return './.pglite';
}

/**
 * Initialize and return the PGlite database instance.
 * This is an async operation as PGlite needs to initialize the WASM engine.
 *
 * @returns Promise<PgliteDatabase<typeof schema>> - Drizzle database instance
 */
export async function getPGliteDb(): Promise<PgliteDatabase<typeof schema>> {
  if (pgliteDb) {
    return pgliteDb;
  }

  const dataPath = getDataPath();
  console.log(`[PGlite] Initializing database at: ${dataPath}`);

  try {
    // Initialize PGlite with file-based persistence
    pgliteClient = new PGlite(dataPath);

    // Wait for PGlite to be ready
    await pgliteClient.waitReady;

    // Create Drizzle ORM instance with schema
    pgliteDb = drizzle(pgliteClient, { schema });

    console.log('[PGlite] Database initialized successfully');
    return pgliteDb;
  } catch (error) {
    console.error('[PGlite] Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Close the PGlite database connection.
 * Should be called when the Electron app is shutting down.
 */
export async function closePGliteDb(): Promise<void> {
  if (pgliteClient) {
    try {
      await pgliteClient.close();
      console.log('[PGlite] Database connection closed');
    } catch (error) {
      console.error('[PGlite] Error closing database:', error);
    } finally {
      pgliteClient = null;
      pgliteDb = null;
    }
  }
}

/**
 * Get the raw PGlite client for direct SQL execution.
 * Useful for running migrations or raw queries.
 *
 * @returns Promise<PGlite> - Raw PGlite client
 */
export async function getPGliteClient(): Promise<PGlite> {
  if (!pgliteClient) {
    await getPGliteDb(); // This will initialize pgliteClient
  }
  return pgliteClient!;
}

/**
 * Check if PGlite mode is enabled.
 * Returns true if ELECTRON_MODE environment variable is set to 'true'.
 */
export function isPGliteMode(): boolean {
  return process.env.ELECTRON_MODE === 'true';
}

// Re-export type for use in other modules
export type { PgliteDatabase };
