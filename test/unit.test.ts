import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { resolve, join } from "path";
import { rm, mkdir } from "fs/promises";
import { tmpdir } from "os";

import { loadPathsFile, validateConfig, createStarterStructure } from "../src/paths";
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
