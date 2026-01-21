import { consola } from "consola";
import { join } from "path";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import type { RalphConfig, RunnerState, IterationResult } from "./types";
import { createPrompt } from "./prompt";
import { setCurrentProcess, throwIfCancelled } from "./state";

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";
const AUTH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const INITIAL_TODO_CONTENT = `# Tasks

- [ ] Task 1
- [ ] Task 2

# Notes

_None yet_
`;

/**
 * Get the auth cache file path
 */
function getAuthCachePath(): string {
  return join(homedir(), ".cralph", "auth-cache.json");
}

/**
 * Check if cached auth is still valid
 */
async function isAuthCacheValid(): Promise<boolean> {
  try {
    const cachePath = getAuthCachePath();
    const file = Bun.file(cachePath);
    if (!(await file.exists())) {
      return false;
    }
    const cache = await file.json();
    const cachedAt = cache.timestamp;
    const now = Date.now();
    return now - cachedAt < AUTH_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Save successful auth to cache
 */
async function saveAuthCache(): Promise<void> {
  try {
    const cachePath = getAuthCachePath();
    const cacheDir = join(homedir(), ".cralph");
    await mkdir(cacheDir, { recursive: true });
    await Bun.write(cachePath, JSON.stringify({ timestamp: Date.now() }));
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Check if Claude CLI is authenticated by sending a minimal test prompt
 * Uses cache to avoid checking too frequently (6 hour TTL)
 */
export async function checkClaudeAuth(): Promise<boolean> {
  // Check cache first
  if (await isAuthCacheValid()) {
    return true;
  }

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
    
    // If exit code is 0, auth is working - save to cache
    if (exitCode === 0) {
      await saveAuthCache();
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if the TODO file is in a clean/initial state
 */
async function isTodoClean(todoPath: string): Promise<boolean> {
  const file = Bun.file(todoPath);
  if (!(await file.exists())) {
    return true; // Non-existent is considered clean
  }
  const content = await file.text();
  return content.trim() === INITIAL_TODO_CONTENT.trim();
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

  // Check TODO file state
  const todoFile = Bun.file(state.todoFile);
  const todoExists = await todoFile.exists();
  
  if (!todoExists) {
    // Create fresh TODO file
    await Bun.write(state.todoFile, INITIAL_TODO_CONTENT);
  } else if (!(await isTodoClean(state.todoFile))) {
    // TODO exists and has been modified - ask about reset
    const response = await consola.prompt(
      "Found existing TODO with progress. Reset to start fresh?",
      {
        type: "confirm",
        cancel: "symbol",
        initial: true,
      }
    );
    
    throwIfCancelled(response);
    
    if (response === true) {
      await Bun.write(state.todoFile, INITIAL_TODO_CONTENT);
      consola.info("TODO reset to clean state");
    } else {
      consola.info("Continuing with existing TODO state");
    }
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
  
  setCurrentProcess(proc);

  // Collect output
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  setCurrentProcess(null);

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

  // Build prompt once
  const prompt = await createPrompt(config, state.todoFile);

  // Ensure output directory exists
  await mkdir(config.output, { recursive: true });

  consola.info("Press Ctrl+C to stop\n");

  // Main loop
  while (true) {
    console.log("━".repeat(40));

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
