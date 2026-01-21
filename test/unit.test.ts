import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { resolve, join } from "path";
import { rm, mkdir } from "fs/promises";

import { loadPathsFile, validateConfig } from "../src/paths";
import { createPrompt, buildPrompt } from "../src/prompt";
import type { RalphConfig } from "../src/types";

const TEST_DIR = resolve(import.meta.dir);
const REFS_DIR = join(TEST_DIR, "refs");
const RULE_FILE = join(TEST_DIR, "rule.md");
const OUTPUT_DIR = TEST_DIR; // Use current dir as output (.)
const RALPH_DIR = join(TEST_DIR, ".ralph");
const PATHS_FILE = join(RALPH_DIR, "paths.json");

// Ensure .ralph directory exists
beforeAll(async () => {
  await mkdir(RALPH_DIR, { recursive: true });
});

// Cleanup .ralph directory created during tests
async function cleanupRalphDir() {
  try {
    await rm(RALPH_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
}

afterAll(async () => {
  await cleanupRalphDir();
});

describe("paths", () => {
  test("loadPathsFile loads valid JSON config", async () => {
    // Create paths file inline for this test
    await Bun.write(PATHS_FILE, JSON.stringify({
      refs: ["./refs"],
      rule: "./rule.md",
      output: "."
    }, null, 2));

    const config = await loadPathsFile(PATHS_FILE);
    
    expect(config).toBeDefined();
    expect(config.refs).toBeArray();
    expect(config.refs).toContain("./refs");
    expect(config.rule).toBe("./rule.md");
    expect(config.output).toBe(".");
  });

  test("loadPathsFile throws for missing file", async () => {
    expect(loadPathsFile("/nonexistent/path.json")).rejects.toThrow();
  });

  test("validateConfig passes for valid config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: OUTPUT_DIR,
    };

    // Should not throw
    await expect(validateConfig(config)).resolves.toBeUndefined();
  });

  test("validateConfig throws for missing refs", async () => {
    const config: RalphConfig = {
      refs: ["/nonexistent/refs"],
      rule: RULE_FILE,
      output: OUTPUT_DIR,
    };

    await expect(validateConfig(config)).rejects.toThrow("Refs path does not exist");
  });

  test("validateConfig throws for missing rule file", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: "/nonexistent/rule.md",
      output: OUTPUT_DIR,
    };

    await expect(validateConfig(config)).rejects.toThrow("Rule file does not exist");
  });
});

describe("prompt", () => {
  test("buildPrompt creates prompt with rule and config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: OUTPUT_DIR,
    };
    const ruleContent = "# Test Rules\nDo something.";
    
    const prompt = buildPrompt(config, ruleContent);
    
    expect(prompt).toContain("# Test Rules");
    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(OUTPUT_DIR);
    expect(prompt).toContain("<promise>COMPLETE</promise>");
  });

  test("createPrompt builds prompt from config", async () => {
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: OUTPUT_DIR,
    };

    const prompt = await createPrompt(config);
    
    expect(prompt).toContain("# Test Rules");
    expect(prompt).toContain(REFS_DIR);
    expect(prompt).toContain(OUTPUT_DIR);
  });
});

describe("config integration", () => {
  test("full config flow works", async () => {
    // Ensure paths file exists for this test
    await Bun.write(PATHS_FILE, JSON.stringify({
      refs: ["./refs"],
      rule: "./rule.md",
      output: "."
    }, null, 2));

    // Load paths file
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
    const prompt = await createPrompt(config);

    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(100);
  });
});

describe("config file generation", () => {
  test("CLI saves ralph.paths.json with correct format", async () => {
    // Simulate what the CLI does when saving config
    const cwd = TEST_DIR;
    const config: RalphConfig = {
      refs: [REFS_DIR],
      rule: RULE_FILE,
      output: TEST_DIR,
    };

    // This is the same logic as in cli.ts
    const pathsConfig = {
      refs: config.refs.map((r) => "./" + r.replace(cwd + "/", "")),
      rule: "./" + config.rule.replace(cwd + "/", ""),
      output: config.output === cwd ? "." : "./" + config.output.replace(cwd + "/", ""),
    };

    await Bun.write(PATHS_FILE, JSON.stringify(pathsConfig, null, 2));

    // Verify the file was created with correct content
    const file = Bun.file(PATHS_FILE);
    expect(await file.exists()).toBe(true);

    const content = await file.json();
    expect(content.refs).toContain("./refs");
    expect(content.rule).toBe("./rule.md");
    expect(content.output).toBe(".");
  });

  test("generated config can be loaded back", async () => {
    // The file should exist from previous test
    const loaded = await loadPathsFile(PATHS_FILE);

    expect(loaded.refs).toContain("./refs");
    expect(loaded.rule).toBe("./rule.md");
    expect(loaded.output).toBe(".");

    // Resolve and validate
    const config: RalphConfig = {
      refs: loaded.refs.map((r) => resolve(TEST_DIR, r)),
      rule: resolve(TEST_DIR, loaded.rule),
      output: resolve(TEST_DIR, loaded.output),
    };

    await expect(validateConfig(config)).resolves.toBeUndefined();
  });
});

describe("cli args parsing", () => {
  test("help flag shows help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
      cwd: resolve(TEST_DIR, ".."),
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
