/**
 * Global state shared across modules
 * 
 * This module provides centralized state management for:
 * - Graceful shutdown handling (Ctrl+C / SIGINT / SIGTERM)
 */

let shuttingDown = false;

/**
 * Mark the process as shutting down
 */
export function setShuttingDown(): void {
  shuttingDown = true;
}

/**
 * Check if the process is shutting down (Ctrl+C was pressed)
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Reset shutdown state (for testing purposes only)
 */
export function resetShutdownState(): void {
  shuttingDown = false;
}
