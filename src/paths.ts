import { consola } from "consola";
import { resolve, join } from "path";
import { readdir, stat, mkdir } from "fs/promises";
import type { Dirent } from "fs";
import type { PathsFileConfig, RalphConfig } from "./types";
import { isAccessError, shouldExcludeDir } from "./platform";
import { throwIfCancelled } from "./state";

// Starter rule template for new projects
const STARTER_RULE = `I want a file named hello.txt
`;

// Dim text helper
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CONTROLS = dim("↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit");

/**
 * Convert a PathsFileConfig to a resolved RalphConfig
 */
export function resolvePathsConfig(loaded: PathsFileConfig, cwd: string): RalphConfig {
  return {
    refs: loaded.refs.map((r) => resolve(cwd, r)),
    rule: resolve(cwd, loaded.rule),
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
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
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
  
  // Create .ralph/rule.md
  const rulePath = join(ralphDir, "rule.md");
  await Bun.write(rulePath, STARTER_RULE);
  consola.info("Created .ralph/rule.md with starter template");
  
  // Create .ralph/paths.json with default config
  const pathsConfig = {
    refs: ["./.ralph/refs"],
    rule: "./.ralph/rule.md",
    output: ".",
  };
  await Bun.write(join(ralphDir, "paths.json"), JSON.stringify(pathsConfig, null, 2));
  consola.info("Created .ralph/paths.json");
  
  consola.box("1. Add source files to .ralph/refs/\n2. Edit .ralph/rule.md with your instructions\n3. Run cralph again");
}

/**
 * Prompt user to select refs directories (simple multiselect)
 * @param autoConfirm - If true, skip confirmation prompts
 */
export async function selectRefs(cwd: string, defaults?: string[], autoConfirm?: boolean): Promise<string[]> {
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
        process.exit(0);
      }
      
      // action === "manual" - continue to directory selection
    } else {
      // Auto-confirm mode: create starter structure
      await createStarterStructure(cwd);
      process.exit(0);
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
 * Prompt user to select a rule file
 */
export async function selectRule(cwd: string, defaultRule?: string): Promise<string> {
  let files = await listFilesRecursive(cwd, [".mdc", ".md"]);
  if (files.length === 0) {
    // This shouldn't happen if selectRefs ran first, but handle it just in case
    const rulePath = join(cwd, "rule.md");
    await Bun.write(rulePath, STARTER_RULE);
    consola.info("Created rule.md with starter template");
    consola.box("Edit rule.md with your instructions then run cralph again");
    process.exit(0);
  }

  // Show relative paths for readability
  const options = files.map((f) => ({
    label: `📄 ${f.replace(cwd + "/", "")}`,
    value: f,
    hint: f === defaultRule ? "current" : (f.endsWith(".mdc") ? "cursor rule" : "markdown"),
  }));

  // Find initial value for default selection
  const initialValue = defaultRule && files.includes(defaultRule) ? defaultRule : files[0];

  console.log(CONTROLS);
  const selected = await consola.prompt("Select rule file:", {
    type: "select",
    cancel: "symbol",
    options,
    initial: initialValue,
  });

  throwIfCancelled(selected);
  return selected as string;
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
 * Returns: { action: "run", path: string } | { action: "edit" } | null
 * @param autoRun - If true, skip prompt and auto-select "run" when config exists
 */
export async function checkForPathsFile(cwd: string, autoRun?: boolean): Promise<{ action: "run"; path: string } | { action: "edit" } | null> {
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
          { label: "✏️  Edit configuration", value: "edit" },
        ],
      }
    );
    
    throwIfCancelled(action);
    
    if (action === "run") {
      return { action: "run", path: filePath };
    }
    return { action: "edit" };
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

  // Check rule file
  const ruleFile = Bun.file(config.rule);
  if (!(await ruleFile.exists())) {
    throw new Error(`Rule file does not exist: ${config.rule}`);
  }

  // Output directory will be created if needed
}
