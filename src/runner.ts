import { consola } from "consola";
import { join } from "path";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import type { RalphConfig, RunnerState, IterationResult } from "./types";
import { createPrompt } from "./prompt";
import { setCurrentProcess } from "./state";

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";
const AUTH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const INITIAL_TODO_CONTENT = `# Tasks

- [ ] Task 1
- [ ] Task 2

---

# Notes

_Append progress and learnings here after each iteration_
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
 * Convert a # GOAL TODO into a proper task list using Claude.
 * Claude reads the refs/codebase to produce a meaningful, compact task list.
 */
async function convertGoalToTasks(todoPath: string, content: string, refs: string[]): Promise<void> {
  const goal = content.replace(/^#\s*GOAL\s*/i, "").trim();

  consola.start("Reading codebase and generating task list...");

  const refsSection = refs.length > 0
    ? `## Reference Material\n\nRead the following directories to understand the codebase before generating tasks:\n${refs.map((r) => `- ${r}`).join("\n")}\n\n`
    : "";

  const prompt = `You are generating a task list for an autonomous coding agent.

${refsSection}## Goal

${goal}

## Instructions

${refs.length > 0 ? "1. First, read the reference directories above to understand the existing code, structure, and patterns.\n2. Then, based" : "Based"} on the goal and your understanding of the codebase, produce a compact, actionable task list.

Rules:
- Always break down the goal into multiple high-level tasks representing the logical steps to achieve it (e.g., "a todo list" → project setup, data model, CRUD operations, UI, etc.)
- Never produce a single task that just restates the goal — decompose it into its natural components
- Keep tasks concise and specific — each should be completable in one iteration
- Preserve the user's intent and wording where possible
- Order tasks by dependency (foundational work first)
- Do NOT over-specify implementation details — keep tasks at a high level so the agent can decide the approach
- Do NOT add unnecessary tasks (no boilerplate setup unless explicitly needed)
- Do NOT fill in the Notes section — leave it with just the placeholder

Output ONLY the raw markdown below — no preamble, no explanation, no reasoning, no code fences. Your response must start with "# Tasks" on the very first line:

# Tasks

- [ ] First task
- [ ] Second task

---

# Notes

_Append progress and learnings here after each iteration_`;

  try {
    const proc = Bun.spawn(["claude", "-p", "--dangerously-skip-permissions"], {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await Promise.race([
      (async () => {
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        return { stdout, exitCode };
      })(),
      (async () => {
        await Bun.sleep(60000);
        proc.kill();
        return null;
      })(),
    ]);

    if (!result) {
      consola.error("Goal conversion timed out (60s limit)");
      return;
    }

    if (result.exitCode !== 0) {
      consola.error("Failed to convert goal to tasks");
      return;
    }

    // Strip any preamble — output must start with "# Tasks"
    let output = result.stdout.trim();
    const tasksIndex = output.indexOf("# Tasks");
    if (tasksIndex > 0) {
      output = output.slice(tasksIndex);
    }
    await Bun.write(todoPath, output.trim() + "\n");
    consola.success("Task list generated");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    consola.error(`Failed to convert goal: ${msg}`);
  }
}

/**
 * Initialize the runner state and log file
 */
async function initRunner(config: RalphConfig): Promise<RunnerState> {
  const ralphDir = join(config.output, ".ralph");
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

  // Create TODO file if it doesn't exist
  const todoFile = Bun.file(state.todoFile);
  if (!(await todoFile.exists())) {
    await Bun.write(state.todoFile, INITIAL_TODO_CONTENT);
  } else {
    // If TODO starts with # GOAL, convert it to a task list
    const content = await todoFile.text();
    if (content.trimStart().startsWith("# GOAL")) {
      await convertGoalToTasks(state.todoFile, content, config.refs);
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
 * Try to commit progress after each iteration
 * Fails gracefully - logs warning and continues if commit fails
 */
async function tryCommitProgress(state: RunnerState, cwd: string): Promise<void> {
  try {
    // Stage all changes
    const addProc = Bun.spawn(["git", "add", "-A"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    await addProc.exited;

    // Commit with iteration number
    const commitMessage = `chore(ralph): iteration ${state.iteration} progress`;
    const commitProc = Bun.spawn(
      ["git", "commit", "-m", commitMessage, "--no-verify"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    
    const exitCode = await commitProc.exited;
    
    if (exitCode === 0) {
      consola.info(`Committed iteration ${state.iteration} progress`);
      await log(state, `Committed: ${commitMessage}`);
    } else {
      // Exit code 1 usually means nothing to commit
      await log(state, `No changes to commit for iteration ${state.iteration}`);
    }
  } catch (error) {
    // Gracefully fail - just log and continue
    const errorMsg = error instanceof Error ? error.message : String(error);
    consola.warn(`Could not commit progress: ${errorMsg}`);
    await log(state, `Commit failed: ${errorMsg}`);
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
  const state = await initRunner(config);
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

    // Try to commit progress after each iteration (fails gracefully)
    await tryCommitProgress(state, cwd);

    if (result.isComplete) {
      break;
    }

    // Small delay between iterations
    await Bun.sleep(2000);
  }

  const duration = (Date.now() - state.startTime.getTime()) / 1000;
  consola.success(`Finished in ${duration.toFixed(1)}s`);
}
