import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { resolve, join } from "path";
import { rm, mkdir } from "fs/promises";

import { checkClaudeAuth } from "../src/runner";

const TEST_DIR = resolve(import.meta.dir);
const RALPH_DIR = join(TEST_DIR, ".ralph");
const SAMPLE_FILE = join(TEST_DIR, "refs", "sample.txt");
const OUTPUT_FILE = join(TEST_DIR, "output.txt");

// Skip all tests if Claude is not authenticated
let isAuthed = false;

beforeAll(async () => {
  isAuthed = await checkClaudeAuth();
  if (isAuthed) {
    // Create .ralph config pointing to existing test files
    await mkdir(RALPH_DIR, { recursive: true });

    await Bun.write(
      join(RALPH_DIR, "paths.json"),
      JSON.stringify(
        {
          refs: ["./refs"],
          rule: "./rule.md",
          output: ".",
        },
        null,
        2
      )
    );
  }
});

afterAll(async () => {
  // Cleanup generated files
  try {
    await rm(RALPH_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
  try {
    await rm(OUTPUT_FILE);
  } catch {
    // File may not exist
  }
});

describe("e2e", () => {
  test("Claude CLI is authenticated", async () => {
    expect(isAuthed).toBe(true);
  });

  test("CLI runs with config and produces output", async () => {
    if (!isAuthed) {
      console.log("Skipping: Claude not authenticated");
      return;
    }

    // Run CLI from test directory with --yes to auto-confirm
    const proc = Bun.spawn(["bun", "run", join(TEST_DIR, "..", "src", "cli.ts"), "--yes"], {
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

    // Check that output.txt was created and matches sample.txt
    const outputFile = Bun.file(OUTPUT_FILE);
    const sampleFile = Bun.file(SAMPLE_FILE);
    
    const exists = await outputFile.exists();
    expect(exists).toBe(true);

    if (exists) {
      const outputContent = await outputFile.text();
      const sampleContent = await sampleFile.text();
      expect(outputContent).toBe(sampleContent);
    }
  }, 120000); // 2 min timeout for full CLI run
});
