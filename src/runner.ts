import { consola } from "consola";
import { join } from "path";
import { mkdir } from "fs/promises";
import type { RalphConfig, RunnerState, IterationResult } from "./types";
import { createPrompt } from "./prompt";

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

/**
 * Check if Claude CLI is authenticated by sending a minimal test prompt
 */
export async function checkClaudeAuth(): Promise<boolean> {
  try {
    // Send a minimal prompt to test auth
    const proc = Bun.spawn(["claude", "-p"], {
      stdin: new Blob(["Reply with just 'ok'"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    
    const output = stdout + stderr;
    
    // Check for auth errors
    if (output.includes("authentication_error") || 
        output.includes("OAuth token has expired") ||
        output.includes("Please run /login") ||
        output.includes("401")) {
      return false;
    }
    
    // If exit code is 0, auth is working
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run Claude login flow
 */
export async function runClaudeLogin(): Promise<boolean> {
  consola.info("Opening Claude login...\n");
  
  // Run claude login interactively
  const proc = Bun.spawn(["claude", "/login"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  
  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Initialize the runner state and log file
 */
async function initRunner(outputDir: string): Promise<RunnerState> {
  const ralphDir = join(outputDir, ".ralph");
  await mkdir(ralphDir, { recursive: true });

  const state: RunnerState = {
    iteration: 0,
    startTime: new Date(),
    logFile: join(ralphDir, "ralph.log"),
    todoFile: join(ralphDir, "TODO.md"),
  };

  // Initialize log file
  const logHeader = `═══════════════════════════════════════
Ralph Session: ${state.startTime.toISOString()}
═══════════════════════════════════════\n`;

  await Bun.write(state.logFile, logHeader);

  // Initialize TODO file if not exists
  const todoFile = Bun.file(state.todoFile);
  if (!(await todoFile.exists())) {
    await Bun.write(
      state.todoFile,
      `# Ralph Agent Status

## Current Status

Idle - waiting for documents in refs/

## Processed Files

_None yet_

## Pending

_Check refs/ for new documents_
`
    );
  }

  return state;
}

/**
 * Append to log file
 */
async function log(state: RunnerState, message: string): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  const logLine = `[${timestamp}] ${message}\n`;
  const file = Bun.file(state.logFile);
  const existing = await file.text();
  await Bun.write(state.logFile, existing + logLine);
}

/**
 * Count files in refs directories (excluding .gitkeep and hidden files)
 */
async function countRefs(refs: string[]): Promise<number> {
  let count = 0;

  for (const refPath of refs) {
    try {
      const entries = await Array.fromAsync(
        new Bun.Glob("**/*").scan({ cwd: refPath, onlyFiles: true })
      );
      count += entries.filter(
        (e) => !e.startsWith(".") && !e.includes("/.") && e !== ".gitkeep"
      ).length;
    } catch {
      // Directory might not exist or be empty
    }
  }

  return count;
}

// Track current subprocess for cleanup
let currentProc: ReturnType<typeof Bun.spawn> | null = null;

/**
 * Kill any running subprocess on exit
 */
export function cleanupSubprocess() {
  if (currentProc) {
    try {
      currentProc.kill();
    } catch {
      // Process may have already exited
    }
    currentProc = null;
  }
}

/**
 * Run a single Claude iteration
 */
async function runIteration(
  prompt: string,
  state: RunnerState,
  cwd: string
): Promise<IterationResult> {
  state.iteration++;

  consola.info(`Iteration ${state.iteration} — invoking Claude...`);
  await log(state, `Iteration ${state.iteration} starting`);

  // Run claude with the prompt piped in
  const proc = Bun.spawn(["claude", "-p", "--dangerously-skip-permissions"], {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    cwd,
  });
  
  currentProc = proc;

  // Collect output
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  currentProc = null;

  const output = stdout + stderr;

  // Log output
  await log(state, output);

  // Check for completion signal
  const isComplete = output.includes(COMPLETION_SIGNAL);

  if (isComplete) {
    consola.success(
      `Complete! All files processed in ${state.iteration} iteration(s).`
    );
  } else if (exitCode === 0) {
    consola.info(`Iteration ${state.iteration} complete`);
  } else {
    consola.warn(`Iteration ${state.iteration} exited with code ${exitCode}`);
  }

  // Print Claude's output
  console.log(output);

  return { exitCode, output, isComplete };
}

/**
 * Main runner loop
 */
export async function run(config: RalphConfig): Promise<void> {
  const cwd = process.cwd();

  consola.box("cralph");
  consola.info("Starting ralph...");

  // Initialize state
  const state = await initRunner(config.output);
  consola.info(`Log: ${state.logFile}`);
  consola.info(`TODO: ${state.todoFile}`);

  // Count initial refs
  const initialCount = await countRefs(config.refs);
  consola.info(`Found ${initialCount} files to process`);

  if (initialCount === 0) {
    consola.warn("No files found in refs directories");
    return;
  }

  // Build prompt once
  const prompt = await createPrompt(config);

  // Ensure output directory exists
  await mkdir(config.output, { recursive: true });

  consola.info("Press Ctrl+C to stop\n");

  // Main loop
  while (true) {
    console.log("━".repeat(40));

    const refCount = await countRefs(config.refs);
    consola.info(`${refCount} ref files remaining`);

    const result = await runIteration(prompt, state, cwd);

    if (result.isComplete) {
      break;
    }

    // Small delay between iterations
    await Bun.sleep(2000);
  }

  const duration = (Date.now() - state.startTime.getTime()) / 1000;
  consola.success(`Finished in ${duration.toFixed(1)}s`);
}
