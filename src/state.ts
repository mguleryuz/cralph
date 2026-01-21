/**
 * Global state shared across modules
 * 
 * This module provides centralized state management for:
 * - Graceful shutdown handling (Ctrl+C / SIGINT / SIGTERM)
 * - Subprocess tracking for cleanup
 */

// Shutdown state
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

// Subprocess tracking
let currentProc: ReturnType<typeof Bun.spawn> | null = null;

/**
 * Set the current running subprocess for tracking
 */
export function setCurrentProcess(proc: ReturnType<typeof Bun.spawn> | null): void {
  currentProc = proc;
}

/**
 * Kill any running subprocess on exit
 */
export function cleanupSubprocess(): void {
  if (currentProc) {
    try {
      currentProc.kill();
    } catch {
      // Process may have already exited
    }
    currentProc = null;
  }
}
