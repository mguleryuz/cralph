import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { resolve, join } from "path";
import { rm, mkdir } from "fs/promises";
import { tmpdir } from "os";

import { checkClaudeAuth } from "../src/runner";

// Use a temp directory for e2e tests
const TEST_DIR = join(tmpdir(), `cralph-e2e-${Date.now()}`);
const CLI_PATH = resolve(import.meta.dir, "..", "src", "cli.ts");

// Skip all tests if Claude is not authenticated
let isAuthed = false;

beforeAll(async () => {
  isAuthed = await checkClaudeAuth();
  if (isAuthed) {
    // Just create empty test directory - CLI handles the rest
    await mkdir(TEST_DIR, { recursive: true });
  }
});

afterAll(async () => {
  // Cleanup test directory
  try {
    await rm(TEST_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
});

describe("e2e", () => {
  test("Claude CLI is authenticated", async () => {
    expect(isAuthed).toBe(true);
  });

  test("CLI creates starter structure in empty directory", async () => {
    if (!isAuthed) {
      console.log("Skipping: Claude not authenticated");
      return;
    }

    // Run CLI in empty directory with --yes to auto-confirm starter creation
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--yes"], {
      cwd: TEST_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    const output = stdout + stderr;

    // Should exit cleanly after creating starter
    expect(exitCode).toBe(0);
    expect(output).toContain("Created .ralph/refs/");
    expect(output).toContain("Created .ralph/rule.md");
    expect(output).toContain("Created .ralph/paths.json");

    // Verify files were created
    expect(await Bun.file(join(TEST_DIR, ".ralph", "paths.json")).exists()).toBe(true);
    expect(await Bun.file(join(TEST_DIR, ".ralph", "rule.md")).exists()).toBe(true);
  });

  test("CLI runs with starter config and produces output", async () => {
    if (!isAuthed) {
      console.log("Skipping: Claude not authenticated");
      return;
    }

    // Run CLI with --yes to auto-confirm (starter already created by previous test)
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--yes"], {
      cwd: TEST_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    const output = stdout + stderr;

    // Should complete successfully
    expect(exitCode).toBe(0);
    expect(output).toContain("COMPLETE");

    // Check that hello.txt was created (as per the default starter rule)
    const outputFile = Bun.file(join(TEST_DIR, "hello.txt"));
    expect(await outputFile.exists()).toBe(true);
  }, 120000); // 2 min timeout for full CLI run
});
