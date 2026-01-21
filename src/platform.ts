import { platform } from "os";
import { which } from "bun";

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

// ============================================================================
// Claude CLI Detection
// ============================================================================

/**
 * Platform-specific install instructions for Claude CLI
 */
const CLAUDE_INSTALL_INSTRUCTIONS: Record<Platform, string> = {
  darwin: `Install Claude CLI:
  npm install -g @anthropic-ai/claude-code

Or via Homebrew:
  brew install claude`,
  linux: `Install Claude CLI:
  npm install -g @anthropic-ai/claude-code`,
  win32: `Install Claude CLI:
  npm install -g @anthropic-ai/claude-code`,
  unknown: `Install Claude CLI:
  npm install -g @anthropic-ai/claude-code`,
};

/**
 * Get platform-specific Claude CLI install instructions
 */
export function getClaudeInstallInstructions(): string {
  return CLAUDE_INSTALL_INSTRUCTIONS[getPlatform()];
}

/**
 * Check if Claude CLI is installed and available in PATH
 */
export async function isClaudeInstalled(): Promise<boolean> {
  try {
    const claudePath = which("claude");
    return claudePath !== null;
  } catch {
    return false;
  }
}

/**
 * Result of Claude CLI check
 */
export interface ClaudeCheckResult {
  installed: boolean;
  path?: string;
  installInstructions: string;
}

/**
 * Check Claude CLI installation and return detailed result
 */
export async function checkClaudeInstallation(): Promise<ClaudeCheckResult> {
  const installInstructions = getClaudeInstallInstructions();
  
  try {
    const claudePath = which("claude");
    if (claudePath) {
      return {
        installed: true,
        path: claudePath,
        installInstructions,
      };
    }
    return {
      installed: false,
      installInstructions,
    };
  } catch {
    return {
      installed: false,
      installInstructions,
    };
  }
}
