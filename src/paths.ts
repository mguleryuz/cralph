import { consola } from "consola";
import { resolve, join } from "path";
import { readdir, stat, mkdir } from "fs/promises";
import type { PathsFileConfig, RalphConfig } from "./types";

// Dim text helper
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CONTROLS = dim("↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit");

/**
 * List directories in a given path
 */
async function listDirectories(basePath: string): Promise<string[]> {
  const entries = await readdir(basePath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

/**
 * Directories to exclude from listing
 */
const EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  "__pycache__",
  "vendor",
  ".cache",
];

/**
 * List directories recursively up to a certain depth
 */
async function listDirectoriesRecursive(
  basePath: string,
  maxDepth: number = 3
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden and excluded directories
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (EXCLUDED_DIRS.includes(entry.name)) continue;
      
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
async function listFilesRecursive(
  basePath: string,
  extensions: string[]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden and excluded directories
        if (entry.name.startsWith(".")) continue;
        if (EXCLUDED_DIRS.includes(entry.name)) continue;
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
  
  // Create refs/
  const refsDir = join(cwd, "refs");
  await mkdir(refsDir, { recursive: true });
  consola.info("Created refs/ directory");
  
  // Create rule.md
  const rulePath = join(cwd, "rule.md");
  await Bun.write(rulePath, STARTER_RULE);
  consola.info("Created rule.md with starter template");
  
  // Create .ralph/paths.json with default config
  const pathsConfig = {
    refs: ["./refs"],
    rule: "./rule.md",
    output: ".",
  };
  await Bun.write(join(ralphDir, "paths.json"), JSON.stringify(pathsConfig, null, 2));
  consola.info("Created .ralph/paths.json");
  
  consola.box("1. Add source files to refs/\n2. Edit rule.md with your instructions\n3. Run cralph again");
}

/**
 * Prompt user to select refs directories (simple multiselect)
 */
export async function selectRefs(cwd: string, defaults?: string[]): Promise<string[]> {
  // Get all directories up to 3 levels deep
  let allDirs = await listDirectoriesRecursive(cwd, 3);
  
  if (allDirs.length === 0) {
    // Create starter structure and exit gracefully
    await createStarterStructure(cwd);
    process.exit(0);
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
    options,
    initial: initialValues,
  });

  // Handle cancel (symbol) or empty result
  if (typeof selected === "symbol" || !selected || (Array.isArray(selected) && selected.length === 0)) {
    throw new Error("Selection cancelled");
  }
  
  return selected as string[];
}

const STARTER_RULE = `I want a simple ui with a red button
`;

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

  // Find index of default for initial selection
  const initialIndex = defaultRule ? files.findIndex((f) => f === defaultRule) : 0;

  console.log(CONTROLS);
  const selected = await consola.prompt("Select rule file:", {
    type: "select",
    options,
    initial: initialIndex >= 0 ? initialIndex : 0,
  });

  if (typeof selected === "symbol") throw new Error("Selection cancelled");
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

  // Find initial index
  let initialIndex = 0;
  if (defaultDir) {
    const idx = defaultDir === "." ? 0 : dirs.findIndex((d) => d === defaultDir) + 1;
    if (idx >= 0) initialIndex = idx;
  }

  console.log(CONTROLS);
  const selected = await consola.prompt("Select output directory:", {
    type: "select",
    options,
    initial: initialIndex,
  });

  if (typeof selected === "symbol") throw new Error("Selection cancelled");

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
        options: [
          { label: "🚀 Run with this config", value: "run" },
          { label: "✏️  Edit configuration", value: "edit" },
        ],
      }
    );
    
    if (typeof action === "symbol") {
      throw new Error("Selection cancelled");
    }
    
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

/**
 * Interactive configuration builder
 */
export async function buildConfig(cwd: string): Promise<RalphConfig> {
  // Check for existing paths file first
  const pathsFile = await checkForPathsFile(cwd);

  if (pathsFile) {
    const loaded = await loadPathsFile(pathsFile);
    return {
      refs: loaded.refs.map((r) => resolve(cwd, r)),
      rule: resolve(cwd, loaded.rule),
      output: resolve(cwd, loaded.output),
    };
  }

  // Interactive selection
  const refs = await selectRefs(cwd);
  const rule = await selectRule(cwd);
  const output = await selectOutput(cwd);

  return { refs, rule, output };
}
