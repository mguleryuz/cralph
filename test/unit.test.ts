import { test, expect, describe, afterAll, beforeAll, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { rm, mkdir } from "fs/promises";
import { tmpdir } from "os";

import {
  loadPathsFile,
  validateConfig,
  createStarterStructure,
  listDirectoriesRecursive,
  listFilesRecursive,
  resolvePathsConfig,
  toRelativePath,
} from "../src/paths";
import {
  isAccessError,
  getPlatform,
  getPlatformConfig,
  shouldExcludeDir,
  EXCLUDED_DIRS,
  isClaudeInstalled,
  checkClaudeInstallation,
  getClaudeInstallInstructions,
} from "../src/platform";
import {
  setShuttingDown,
  isShuttingDown,
  resetShutdownState,
  throwIfCancelled,
} from "../src/state";
import { createPrompt, buildPrompt } from "../src/prompt";
import type { RalphConfig } from "../src/types";

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DIR = join(tmpdir(), `cralph-test-${Date.now()}`);
const RALPH_DIR = join(TEST_DIR, ".ralph");
const REFS_DIR = join(RALPH_DIR, "refs");
const PATHS_FILE = join(RALPH_DIR, "paths.json");
const TODO_FILE = join(RALPH_DIR, "TODO.md");

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await createStarterStructure(TEST_DIR);
});

afterAll(async () => {
  try {
    await rm(TEST_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
});

// ============================================================================
// Path Configuration Tests
// ============================================================================

describe("paths", () => {
  describe("loadPathsFile", () => {
    test("loads valid JSON config", async () => {
      const config = await loadPathsFile(PATHS_FILE);

      expect(config).toBeDefined();
      expect(config.refs).toBeArray();
      expect(config.refs).toContain("./.ralph/refs");
      expect(config.output).toBe(".");
    });

    test("throws for missing file", async () => {
      await expect(loadPathsFile("/nonexistent/path.json")).rejects.toThrow();
    });
  });

  describe("validateConfig", () => {
    test("passes for valid config", async () => {
      const config: RalphConfig = {
        refs: [REFS_DIR],
        output: TEST_DIR,
      };
      await expect(validateConfig(config)).resolves.toBeUndefined();
    });

    test("throws for missing refs", async () => {
      const config: RalphConfig = {
        refs: ["/nonexistent/refs"],
        output: TEST_DIR,
      };
      await expect(validateConfig(config)).rejects.toThrow("Refs path does not exist");
    });
  });

  describe("resolvePathsConfig", () => {
    test("converts relative to absolute paths", () => {
      const loaded = {
        refs: ["./.ralph/refs", "./src"],
        output: ".",
      };
      const cwd = "/home/user/project";

      const resolved = resolvePathsConfig(loaded, cwd);

      expect(resolved.refs).toEqual([
        "/home/user/project/.ralph/refs",
        "/home/user/project/src",
      ]);
      expect(resolved.output).toBe("/home/user/project");
    });
  });

  describe("toRelativePath", () => {
    test("converts absolute to relative paths", () => {
      const cwd = "/home/user/project";

      expect(toRelativePath("/home/user/project", cwd)).toBe(".");
      expect(toRelativePath("/home/user/project/src", cwd)).toBe("./src");
      expect(toRelativePath("/home/user/project/.ralph/refs", cwd)).toBe("./.ralph/refs");
    });
  });
});

// ============================================================================
// Prompt Building Tests
// ============================================================================

describe("prompt", () => {
  test("buildPrompt creates prompt with config", () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      output: TEST_DIR,
    };

    const prompt = buildPrompt(config, TODO_FILE);

    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(TEST_DIR);
    expect(prompt).toContain(TODO_FILE);
    expect(prompt).toContain("<promise>COMPLETE</promise>");
  });

  test("createPrompt builds prompt from config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      output: TEST_DIR,
    };

    const prompt = await createPrompt(config, TODO_FILE);

    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(TEST_DIR);
    expect(prompt).toContain(TODO_FILE);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("config integration", () => {
  test("full config flow works", async () => {
    const loaded = await loadPathsFile(PATHS_FILE);

    const config: RalphConfig = {
      refs: loaded.refs.map((r) => resolve(TEST_DIR, r)),
      output: resolve(TEST_DIR, loaded.output),
    };

    await validateConfig(config);

    const todoFile = join(config.output, ".ralph", "TODO.md");
    const prompt = await createPrompt(config, todoFile);

    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// Starter Structure Tests
// ============================================================================

describe("starter structure", () => {
  test("creates all required files", async () => {
    expect(await Bun.file(PATHS_FILE).exists()).toBe(true);

    const config = await loadPathsFile(PATHS_FILE);
    expect(config.refs).toContain("./.ralph/refs");
  });

  test("paths.json has correct structure", async () => {
    const config = await loadPathsFile(PATHS_FILE);

    expect(config.refs).toEqual(["./.ralph/refs"]);
    expect(config.output).toBe(".");
  });
});

// ============================================================================
// CLI Tests
// ============================================================================

describe("cli", () => {
  test("help flag shows usage", async () => {
    const proc = Bun.spawn(
      ["bun", "run", resolve(import.meta.dir, "..", "src", "cli.ts"), "--help"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("cralph");
    expect(stdout).toContain("--refs");
    expect(stdout).toContain("--output");
  });
});

// ============================================================================
// Access Error Handling Tests
// ============================================================================

describe("access errors", () => {
  describe("isAccessError", () => {
    test("returns true for EPERM", () => {
      expect(isAccessError({ code: "EPERM" })).toBe(true);
    });

    test("returns true for EACCES", () => {
      expect(isAccessError({ code: "EACCES" })).toBe(true);
    });

    test("returns false for ENOENT", () => {
      expect(isAccessError({ code: "ENOENT" })).toBe(false);
    });

    test("returns false for other error codes", () => {
      expect(isAccessError({ code: "ENOTDIR" })).toBe(false);
    });

    test("returns false for non-error values", () => {
      expect(isAccessError(null)).toBe(false);
      expect(isAccessError(undefined)).toBe(false);
      expect(isAccessError("string")).toBe(false);
      expect(isAccessError({ message: "error" })).toBe(false);
    });
  });

  describe("listDirectoriesRecursive", () => {
    test("handles valid directory", async () => {
      const dirs = await listDirectoriesRecursive(TEST_DIR, 2);
      expect(dirs).toBeArray();
    });

    test("throws for non-existent directory", async () => {
      await expect(
        listDirectoriesRecursive("/nonexistent/path/that/does/not/exist")
      ).rejects.toThrow();
    });
  });

  describe("listFilesRecursive", () => {
    test("handles valid directory", async () => {
      const files = await listFilesRecursive(RALPH_DIR, [".json"]);
      expect(files).toBeArray();
      expect(files.some((f) => f.endsWith("paths.json"))).toBe(true);
    });

    test("throws for non-existent directory", async () => {
      await expect(
        listFilesRecursive("/nonexistent/path", [".md"])
      ).rejects.toThrow();
    });

    test("filters by extension", async () => {
      const jsonFiles = await listFilesRecursive(RALPH_DIR, [".json"]);

      expect(jsonFiles.every((f) => f.endsWith(".json"))).toBe(true);
    });
  });
});

// ============================================================================
// Platform Tests
// ============================================================================

describe("platform", () => {
  test("getPlatform returns valid platform", () => {
    const platform = getPlatform();
    expect(["darwin", "linux", "win32", "unknown"]).toContain(platform);
  });

  test("getPlatformConfig returns config with required fields", () => {
    const config = getPlatformConfig();

    expect(config).toBeDefined();
    expect(config.accessErrorCodes).toBeArray();
    expect(config.accessErrorCodes).toContain("EPERM");
    expect(config.accessErrorCodes).toContain("EACCES");
    expect(config.systemExcludedDirs).toBeArray();
  });

  test("EXCLUDED_DIRS contains common project directories", () => {
    expect(EXCLUDED_DIRS).toContain("node_modules");
    expect(EXCLUDED_DIRS).toContain("dist");
    expect(EXCLUDED_DIRS).toContain(".git");
    expect(EXCLUDED_DIRS).toContain("coverage");
  });

  describe("shouldExcludeDir", () => {
    test("returns true for excluded directories", () => {
      expect(shouldExcludeDir("node_modules")).toBe(true);
      expect(shouldExcludeDir("dist")).toBe(true);
      expect(shouldExcludeDir(".git")).toBe(true);
    });

    test("returns false for regular directories", () => {
      expect(shouldExcludeDir("src")).toBe(false);
      expect(shouldExcludeDir("lib")).toBe(false);
      expect(shouldExcludeDir("app")).toBe(false);
    });
  });

  describe("Claude CLI detection", () => {
    test("getClaudeInstallInstructions returns string with npm command", () => {
      const instructions = getClaudeInstallInstructions();
      expect(typeof instructions).toBe("string");
      expect(instructions).toContain("npm install");
      expect(instructions).toContain("claude");
    });

    test("isClaudeInstalled returns boolean", async () => {
      const installed = await isClaudeInstalled();
      expect(typeof installed).toBe("boolean");
    });

    test("checkClaudeInstallation returns result object", async () => {
      const result = await checkClaudeInstallation();

      expect(result).toBeDefined();
      expect(typeof result.installed).toBe("boolean");
      expect(typeof result.installInstructions).toBe("string");

      if (result.installed) {
        expect(result.path).toBeDefined();
        expect(typeof result.path).toBe("string");
      }
    });

    test("checkClaudeInstallation includes platform-specific instructions", async () => {
      const result = await checkClaudeInstallation();
      const platform = getPlatform();

      // All platforms should have npm install instructions
      expect(result.installInstructions).toContain("npm install");

      // macOS should mention Homebrew
      if (platform === "darwin") {
        expect(result.installInstructions).toContain("brew");
      }
    });
  });
});

// ============================================================================
// State Management Tests
// ============================================================================

describe("state", () => {
  beforeEach(() => {
    resetShutdownState();
  });

  describe("shutdown state", () => {
    test("isShuttingDown returns false initially", () => {
      expect(isShuttingDown()).toBe(false);
    });

    test("setShuttingDown sets state to true", () => {
      setShuttingDown();
      expect(isShuttingDown()).toBe(true);
    });

    test("state remains true after being set", () => {
      setShuttingDown();
      expect(isShuttingDown()).toBe(true);
      expect(isShuttingDown()).toBe(true);
    });

    test("resetShutdownState resets to false", () => {
      setShuttingDown();
      resetShutdownState();
      expect(isShuttingDown()).toBe(false);
    });

    test("multiple setShuttingDown calls are idempotent", () => {
      setShuttingDown();
      setShuttingDown();
      setShuttingDown();
      expect(isShuttingDown()).toBe(true);
    });
  });

  describe("throwIfCancelled", () => {
    test("throws for Symbol (Ctrl+C)", () => {
      const symbol = Symbol("cancel");
      expect(() => throwIfCancelled(symbol)).toThrow("Selection cancelled");
    });

    test("throws when shutting down", () => {
      setShuttingDown();
      expect(() => throwIfCancelled("value")).toThrow("Selection cancelled");
    });

    test("does not throw for normal values", () => {
      expect(() => throwIfCancelled("string")).not.toThrow();
      expect(() => throwIfCancelled(true)).not.toThrow();
      expect(() => throwIfCancelled(false)).not.toThrow();
      expect(() => throwIfCancelled(123)).not.toThrow();
      expect(() => throwIfCancelled({ key: "value" })).not.toThrow();
    });

    test("does not throw for null/undefined when not shutting down", () => {
      expect(() => throwIfCancelled(null)).not.toThrow();
      expect(() => throwIfCancelled(undefined)).not.toThrow();
    });
  });
});
