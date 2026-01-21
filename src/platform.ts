import { platform } from "os";

/**
 * Supported platforms
 */
export type Platform = "darwin" | "linux" | "win32" | "unknown";

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  const p = platform();
  if (p === "darwin" || p === "linux" || p === "win32") {
    return p;
  }
  return "unknown";
}

/**
 * Platform-specific configuration
 */
interface PlatformConfig {
  /** Error codes that indicate permission/access denied */
  accessErrorCodes: string[];
  /** Directories to always exclude from scanning */
  systemExcludedDirs: string[];
}

/**
 * Platform configurations
 */
const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  darwin: {
    accessErrorCodes: ["EPERM", "EACCES"],
    systemExcludedDirs: [
      // macOS protected directories
      "Library",
      "Photos Library.photoslibrary",
      "Photo Booth Library",
    ],
  },
  linux: {
    accessErrorCodes: ["EPERM", "EACCES"],
    systemExcludedDirs: [
      // Linux protected directories
      "lost+found",
      "proc",
      "sys",
    ],
  },
  win32: {
    accessErrorCodes: ["EPERM", "EACCES"],
    systemExcludedDirs: [
      // Windows protected directories
      "System Volume Information",
      "$Recycle.Bin",
      "Windows",
    ],
  },
  unknown: {
    accessErrorCodes: ["EPERM", "EACCES"],
    systemExcludedDirs: [],
  },
};

/**
 * Get platform-specific configuration
 */
export function getPlatformConfig(): PlatformConfig {
  return PLATFORM_CONFIGS[getPlatform()];
}

/**
 * Check if an error is a permission/access error for the current platform
 */
export function isAccessError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    return getPlatformConfig().accessErrorCodes.includes(code);
  }
  return false;
}

/**
 * Check if a directory should be excluded on the current platform
 */
export function isSystemExcludedDir(dirName: string): boolean {
  return getPlatformConfig().systemExcludedDirs.includes(dirName);
}

/**
 * Common directories to exclude across all platforms (project-related)
 */
export const EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  "__pycache__",
  "vendor",
  ".cache",
];

/**
 * Check if a directory should be excluded (combines common + platform-specific)
 */
export function shouldExcludeDir(dirName: string): boolean {
  return EXCLUDED_DIRS.includes(dirName) || isSystemExcludedDir(dirName);
}
