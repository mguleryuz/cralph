// Re-export for programmatic usage
export * from "./src/types";
export { loadPathsFile, validateConfig, resolvePathsConfig, toRelativePath } from "./src/paths";
export { createPrompt, buildPrompt } from "./src/prompt";
export { run, checkClaudeAuth } from "./src/runner";
export { cleanupSubprocess, setShuttingDown, isShuttingDown } from "./src/state";
export { getPlatform, isClaudeInstalled, checkClaudeInstallation } from "./src/platform";
