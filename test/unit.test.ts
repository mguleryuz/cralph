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
} from "../src/paths";
import { 
  isAccessError, 
  getPlatform, 
  getPlatformConfig,
  shouldExcludeDir,
  EXCLUDED_DIRS,
} from "../src/platform";
import {
  setShuttingDown,
  isShuttingDown,
  resetShutdownState,
} from "../src/state";
import { createPrompt, buildPrompt } from "../src/prompt";
import type { RalphConfig } from "../src/types";

// Use a temp directory for tests
const TEST_DIR = join(tmpdir(), `cralph-test-${Date.now()}`);
const RALPH_DIR = join(TEST_DIR, ".ralph");
const REFS_DIR = join(RALPH_DIR, "refs");
const RULE_FILE = join(RALPH_DIR, "rule.md");
const PATHS_FILE = join(RALPH_DIR, "paths.json");
const TODO_FILE = join(RALPH_DIR, "TODO.md");

// Setup test directory with starter structure
beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await createStarterStructure(TEST_DIR);
  
  // Override rule.md with test content
  await Bun.write(RULE_FILE, "# Test Rules\nDo something.");
});

// Cleanup test directory
afterAll(async () => {
  try {
    await rm(TEST_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
});

describe("paths", () => {
  test("loadPathsFile loads valid JSON config", async () => {
    const config = await loadPathsFile(PATHS_FILE);
    
    expect(config).toBeDefined();
    expect(config.refs).toBeArray();
    expect(config.refs).toContain("./.ralph/refs");
    expect(config.rule).toBe("./.ralph/rule.md");
    expect(config.output).toBe(".");
  });

  test("loadPathsFile throws for missing file", async () => {
    expect(loadPathsFile("/nonexistent/path.json")).rejects.toThrow();
  });

  test("validateConfig passes for valid config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: TEST_DIR,
    };

    // Should not throw
    await expect(validateConfig(config)).resolves.toBeUndefined();
  });

  test("validateConfig throws for missing refs", async () => {
    const config: RalphConfig = {
      refs: ["/nonexistent/refs"],
      rule: RULE_FILE,
      output: TEST_DIR,
    };

    await expect(validateConfig(config)).rejects.toThrow("Refs path does not exist");
  });

  test("validateConfig throws for missing rule file", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: "/nonexistent/rule.md",
      output: TEST_DIR,
    };

    await expect(validateConfig(config)).rejects.toThrow("Rule file does not exist");
  });
});

describe("prompt", () => {
  test("buildPrompt creates prompt with rule and config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: TEST_DIR,
    };
    const ruleContent = "# Test Rules\nDo something.";
    
    const prompt = buildPrompt(config, ruleContent, TODO_FILE);
    
    expect(prompt).toContain("# Test Rules");
    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(TEST_DIR);
    expect(prompt).toContain(TODO_FILE);
    expect(prompt).toContain("<promise>COMPLETE</promise>");
  });

  test("createPrompt builds prompt from config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: TEST_DIR,
    };

    const prompt = await createPrompt(config, TODO_FILE);
    
    expect(prompt).toContain("# Test Rules");
    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(TEST_DIR);
    expect(prompt).toContain(TODO_FILE);
  });
});

describe("config integration", () => {
  test("full config flow works", async () => {
    // Load paths file created by starter
    const loaded = await loadPathsFile(PATHS_FILE);
    
    // Build full config with resolved paths
    const config: RalphConfig = {
      refs: loaded.refs.map((r) => resolve(TEST_DIR, r)),
      rule: resolve(TEST_DIR, loaded.rule),
      output: resolve(TEST_DIR, loaded.output),
    };

    // Validate
    await validateConfig(config);

    // Build prompt
    const todoFile = join(config.output, ".ralph", "TODO.md");
    const prompt = await createPrompt(config, todoFile);

    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(100);
  });
});

describe("starter structure", () => {
  test("createStarterStructure creates all required files", async () => {
    // Check files exist
    expect(await Bun.file(PATHS_FILE).exists()).toBe(true);
    expect(await Bun.file(RULE_FILE).exists()).toBe(true);
    
    // Check refs directory exists (by checking we can read from it)
    const refsDir = Bun.file(REFS_DIR);
    // refs is a directory, not a file, so we just verify paths.json points to it
    const config = await loadPathsFile(PATHS_FILE);
    expect(config.refs).toContain("./.ralph/refs");
  });

  test("starter paths.json has correct structure", async () => {
    const config = await loadPathsFile(PATHS_FILE);
    
    expect(config.refs).toEqual(["./.ralph/refs"]);
    expect(config.rule).toBe("./.ralph/rule.md");
    expect(config.output).toBe(".");
  });
});

describe("cli args parsing", () => {
  test("help flag shows help", async () => {
    const proc = Bun.spawn(["bun", "run", resolve(import.meta.dir, "..", "src", "cli.ts"), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("cralph");
    expect(stdout).toContain("--refs");
    expect(stdout).toContain("--rule");
    expect(stdout).toContain("--output");
  });
});

describe("access error handling", () => {
  test("isAccessError returns true for EPERM", () => {
    const error = { code: "EPERM", message: "operation not permitted" };
    expect(isAccessError(error)).toBe(true);
  });

  test("isAccessError returns true for EACCES", () => {
    const error = { code: "EACCES", message: "permission denied" };
    expect(isAccessError(error)).toBe(true);
  });

  test("isAccessError returns false for ENOENT", () => {
    const error = { code: "ENOENT", message: "no such file or directory" };
    expect(isAccessError(error)).toBe(false);
  });

  test("isAccessError returns false for other errors", () => {
    const error = { code: "ENOTDIR", message: "not a directory" };
    expect(isAccessError(error)).toBe(false);
  });

  test("isAccessError returns false for null", () => {
    expect(isAccessError(null)).toBe(false);
  });

  test("isAccessError returns false for undefined", () => {
    expect(isAccessError(undefined)).toBe(false);
  });

  test("isAccessError returns false for string", () => {
    expect(isAccessError("some error")).toBe(false);
  });

  test("isAccessError returns false for error without code", () => {
    const error = { message: "some error" };
    expect(isAccessError(error)).toBe(false);
  });

  test("listDirectoriesRecursive handles valid directory", async () => {
    const dirs = await listDirectoriesRecursive(TEST_DIR, 2);
    // Should return at least some directories (refs is under .ralph which is hidden, so may not appear)
    expect(dirs).toBeArray();
  });

  test("listDirectoriesRecursive returns empty for non-existent directory", async () => {
    // This should throw ENOENT, not be caught as access error
    await expect(listDirectoriesRecursive("/nonexistent/path/that/does/not/exist")).rejects.toThrow();
  });

  test("listFilesRecursive handles valid directory", async () => {
    const files = await listFilesRecursive(RALPH_DIR, [".md", ".json"]);
    expect(files).toBeArray();
    // Should find rule.md and paths.json
    expect(files.some(f => f.endsWith("rule.md"))).toBe(true);
    expect(files.some(f => f.endsWith("paths.json"))).toBe(true);
  });

  test("listFilesRecursive returns empty for non-existent directory", async () => {
    // This should throw ENOENT, not be caught as access error
    await expect(listFilesRecursive("/nonexistent/path/that/does/not/exist", [".md"])).rejects.toThrow();
  });

  test("listFilesRecursive filters by extension", async () => {
    const mdFiles = await listFilesRecursive(RALPH_DIR, [".md"]);
    const jsonFiles = await listFilesRecursive(RALPH_DIR, [".json"]);
    
    expect(mdFiles.every(f => f.endsWith(".md"))).toBe(true);
    expect(jsonFiles.every(f => f.endsWith(".json"))).toBe(true);
  });
});

describe("platform", () => {
  test("getPlatform returns valid platform", () => {
    const platform = getPlatform();
    expect(["darwin", "linux", "win32", "unknown"]).toContain(platform);
  });

  test("getPlatformConfig returns config for current platform", () => {
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

  test("shouldExcludeDir returns true for common excluded dirs", () => {
    expect(shouldExcludeDir("node_modules")).toBe(true);
    expect(shouldExcludeDir("dist")).toBe(true);
    expect(shouldExcludeDir(".git")).toBe(true);
  });

  test("shouldExcludeDir returns false for regular directories", () => {
    expect(shouldExcludeDir("src")).toBe(false);
    expect(shouldExcludeDir("lib")).toBe(false);
    expect(shouldExcludeDir("app")).toBe(false);
  });
});

describe("state", () => {
  // Reset state before each test to ensure isolation
  beforeEach(() => {
    resetShutdownState();
  });

  test("isShuttingDown returns false initially", () => {
    expect(isShuttingDown()).toBe(false);
  });

  test("setShuttingDown sets shutdown state to true", () => {
    expect(isShuttingDown()).toBe(false);
    setShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });

  test("isShuttingDown remains true after being set", () => {
    setShuttingDown();
    expect(isShuttingDown()).toBe(true);
    // Calling again should still be true
    expect(isShuttingDown()).toBe(true);
  });

  test("resetShutdownState resets state to false", () => {
    setShuttingDown();
    expect(isShuttingDown()).toBe(true);
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
