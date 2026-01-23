import { consola } from "consola";
import { resolve, join } from "path";
import { readdir, stat, mkdir } from "fs/promises";
import type { Dirent } from "fs";
import type { PathsFileConfig, RalphConfig } from "./types";
import { isAccessError, shouldExcludeDir } from "./platform";
import { throwIfCancelled } from "./state";

// Dim text helper
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CONTROLS = dim("↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit");

/**
 * Convert a PathsFileConfig to a resolved RalphConfig
 */
export function resolvePathsConfig(loaded: PathsFileConfig, cwd: string): RalphConfig {
  return {
    refs: loaded.refs.map((r) => resolve(cwd, r)),
    output: resolve(cwd, loaded.output),
  };
}

/**
 * Convert an absolute path to a relative path for config storage
 */
export function toRelativePath(absolutePath: string, cwd: string): string {
  if (absolutePath === cwd) return ".";
  return "./" + absolutePath.replace(cwd + "/", "");
}

/**
 * Check if a directory entry should be skipped during traversal
 */
function shouldSkipDirectory(entry: Dirent): boolean {
  if (!entry.isDirectory()) return true;
  if (entry.name === ".ralph") return false; // Always show .ralph
  if (entry.name.startsWith(".")) return true;
  if (shouldExcludeDir(entry.name)) return true;
  return false;
}

/**
 * List directories in a given path
 */
async function listDirectories(basePath: string): Promise<string[]> {
  try {
    const entries = await readdir(basePath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && (e.name === ".ralph" || !e.name.startsWith(".")))
      .map((e) => e.name);
  } catch (error) {
    // Silently skip directories we can't access
    if (isAccessError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * List directories recursively up to a certain depth
 */
export async function listDirectoriesRecursive(
  basePath: string,
  maxDepth: number = 3
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // Silently skip directories we can't access
      if (isAccessError(error)) {
        return;
      }
      throw error;
    }
    
    for (const entry of entries) {
      if (shouldSkipDirectory(entry)) continue;
      
      const fullPath = join(dir, entry.name);
      results.push(fullPath);
      await walk(fullPath, depth + 1);
    }
  }

  await walk(basePath, 1);
  return results;
}

/**
 * List files matching patterns in a directory (recursive)
 */
export async function listFilesRecursive(
  basePath: string,
  extensions: string[]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // Silently skip directories we can't access
      if (isAccessError(error)) {
        return;
      }
      throw error;
    }
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions.some((ext) => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(basePath);
  return results;
}

/**
 * Load configuration from a paths file
 */
export async function loadPathsFile(filePath: string): Promise<PathsFileConfig> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Paths file not found: ${filePath}`);
  }
  const content = await file.json();
  return content as PathsFileConfig;
}

/**
 * Create starter structure for empty directories
 */
export async function createStarterStructure(cwd: string): Promise<void> {
  // Create .ralph/
  const ralphDir = join(cwd, ".ralph");
  await mkdir(ralphDir, { recursive: true });

  // Create .ralph/refs/
  const refsDir = join(ralphDir, "refs");
  await mkdir(refsDir, { recursive: true });
  consola.info("Created .ralph/refs/ directory");

  // Create .ralph/paths.json with default config
  const pathsConfig = {
    refs: ["./.ralph/refs"],
    output: ".",
  };
  await Bun.write(join(ralphDir, "paths.json"), JSON.stringify(pathsConfig, null, 2));
  consola.info("Created .ralph/paths.json");

  consola.box("1. Add source files to .ralph/refs/\n2. Run cralph again to prepare your TODO");
}

/**
 * Prompt user to select refs directories (simple multiselect)
 * @param autoConfirm - If true, skip confirmation prompts
 */
export async function selectRefs(cwd: string, defaults?: string[], autoConfirm?: boolean): Promise<string[] | null> {
  // Check if .ralph/ exists in cwd - if not, offer to create starter structure
  const ralphDir = join(cwd, ".ralph");
  let ralphExists = false;
  try {
    await stat(ralphDir);
    ralphExists = true;
  } catch {
    ralphExists = false;
  }

  if (!ralphExists) {
    // Ask before creating starter structure (skip if autoConfirm)
    if (!autoConfirm) {
      console.log(CONTROLS);
      const action = await consola.prompt(
        `No .ralph/ found in ${cwd}`,
        {
          type: "select",
          cancel: "symbol",
          options: [
            { label: "📦 Create starter structure", value: "create" },
            { label: "⚙️  Configure manually", value: "manual" },
          ],
        }
      );

      throwIfCancelled(action);

      if (action === "create") {
        await createStarterStructure(cwd);
        return null; // Signal to go back to main menu
      }

      // action === "manual" - continue to directory selection
    } else {
      // Auto-confirm mode: create starter structure
      await createStarterStructure(cwd);
      return null; // Signal to go back to main menu
    }
  }

  // Get all directories up to 3 levels deep
  let allDirs = await listDirectoriesRecursive(cwd, 3);
  
  if (allDirs.length === 0) {
    throw new Error("No directories found to select from");
  }

  // Convert to relative paths for display
  const options = allDirs.map((d) => {
    const relative = d.replace(cwd + "/", "");
    const isDefault = defaults?.includes(d);
    return {
      label: `📁 ${relative}`,
      value: d,
      hint: isDefault ? "current" : undefined,
    };
  });

  // Get initial selections (indices of defaults)
  const initialValues = defaults?.filter((d) => allDirs.includes(d)) || [];

  console.log(CONTROLS);
  const selected = await consola.prompt("Select refs directories:", {
    type: "multiselect",
    cancel: "symbol",
    options,
    initial: initialValues,
  });

  // Handle cancel (symbol), shutdown, or empty result
  throwIfCancelled(selected);
  if (!selected || (Array.isArray(selected) && selected.length === 0)) {
    throw new Error("Selection cancelled");
  }
  
  // Cast is safe: multiselect with string values returns string[]
  return selected as unknown as string[];
}

/**
 * Prompt user to prepare TODO.md by describing their tasks
 * Uses Claude to generate a structured TODO.md (no file discovery, 10s max)
 */
export async function prepareTodo(cwd: string): Promise<void> {
  const ralphDir = join(cwd, ".ralph");
  const todoPath = join(ralphDir, "TODO.md");

  const description = await consola.prompt(
    "Describe your tasks (what should Claude work on?):",
    {
      type: "text",
      cancel: "symbol",
      placeholder: "e.g. Build a REST API with user auth, add tests, setup CI...",
    }
  );

  throwIfCancelled(description);

  if (!description || (description as string).trim() === "") {
    consola.warn("No description provided, skipping TODO preparation");
    return;
  }

  consola.start("Generating TODO.md...");

  const todoPrompt = `You are generating a TODO.md file for an autonomous coding agent. Based on the user's description, create a well-structured TODO.md with clear, actionable tasks.

CRITICAL RULES:
- Do NOT read, search, or discover any files
- Do NOT use any tools
- Do NOT investigate the codebase
- ONLY output the TODO.md content based on the user's description
- Rephrase and clean up the user's prompt into clear, UI-suitable task descriptions
- Each task should be a single, focused unit of work
- Tasks should be ordered logically (dependencies first)
- Use the checkbox format: "- [ ] Task description"
- Keep task descriptions concise but specific
- Include a Notes section placeholder at the bottom
- Respond IMMEDIATELY with just the TODO content

User's description:
${(description as string).trim()}

Output ONLY the TODO.md content in markdown format, nothing else. Use this EXACT file format:

\`\`\`
# Tasks

- [ ] First task
- [ ] Second task

---

# Notes

_Append progress and learnings here after each iteration_
\`\`\`

Do NOT wrap your response in a code block. Output the raw markdown directly.`;

  try {
    const proc = Bun.spawn(["claude", "-p", "--max-turns", "1"], {
      stdin: new Blob([todoPrompt]),
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
        await Bun.sleep(10000);
        proc.kill();
        return null;
      })(),
    ]);

    if (!result) {
      consola.error("TODO generation timed out (10s limit)");
      return;
    }

    if (result.exitCode !== 0) {
      consola.error("Failed to generate TODO.md");
      return;
    }

    await mkdir(ralphDir, { recursive: true });
    await Bun.write(todoPath, result.stdout.trim() + "\n");
    consola.success("Generated .ralph/TODO.md");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    consola.error(`Failed to generate TODO: ${msg}`);
  }
}

/**
 * Prompt user to select output directory
 */
export async function selectOutput(cwd: string, defaultOutput?: string): Promise<string> {
  const dirs = await listDirectories(cwd);
  
  // Determine default value for matching
  const defaultDir = defaultOutput === cwd ? "." : defaultOutput?.replace(cwd + "/", "");
  
  const options = [
    { label: "📍 Current directory (.)", value: ".", hint: defaultDir === "." ? "current" : "Output here" },
    ...dirs.map((d) => ({ 
      label: `📁 ${d}`, 
      value: d,
      hint: d === defaultDir ? "current" : undefined,
    })),
  ];

  // Determine initial value for default selection
  const initialValue = defaultDir && (defaultDir === "." || dirs.includes(defaultDir)) 
    ? defaultDir 
    : ".";

  console.log(CONTROLS);
  const selected = await consola.prompt("Select output directory:", {
    type: "select",
    cancel: "symbol",
    options,
    initial: initialValue,
  });

  throwIfCancelled(selected);

  if (selected === ".") {
    return cwd;
  }

  return resolve(cwd, selected as string);
}

/**
 * Check if a paths file exists and offer to use it
 * @param autoRun - If true, skip prompt and auto-select "run" when config exists
 */
export async function checkForPathsFile(cwd: string, autoRun?: boolean): Promise<{ action: "run" | "edit" | "prepare"; path: string } | null> {
  const filePath = join(cwd, ".ralph", "paths.json");
  const file = Bun.file(filePath);

  if (await file.exists()) {
    // Auto-run if flag is set
    if (autoRun) {
      return { action: "run", path: filePath };
    }

    console.log(CONTROLS);
    const action = await consola.prompt(
      `Found .ralph/paths.json. What would you like to do?`,
      {
        type: "select",
        cancel: "symbol",
        options: [
          { label: "🚀 Run with this config", value: "run" },
          { label: "📝 Prepare TODO", value: "prepare" },
          { label: "✏️  Edit configuration", value: "edit" },
        ],
      }
    );

    throwIfCancelled(action);

    return { action: action as "run" | "edit" | "prepare", path: filePath };
  }

  return null;
}

/**
 * Validate that paths exist
 */
export async function validateConfig(config: RalphConfig): Promise<void> {
  // Check refs
  for (const ref of config.refs) {
    try {
      await stat(ref);
    } catch {
      throw new Error(`Refs path does not exist: ${ref}`);
    }
  }

  // Output directory will be created if needed
}
