import { consola } from "consola";
import { resolve, join, basename } from "path";
import { readdir, stat } from "fs/promises";
import type { PathSelectionMode, PathsFileConfig, RalphConfig } from "./types";

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
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
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
 * Prompt user for path selection mode
 */
async function askSelectionMode(label: string): Promise<PathSelectionMode> {
  const mode = await consola.prompt(`How would you like to specify ${label}?`, {
    type: "select",
    options: [
      { label: "📂 Select from current directory", value: "select", hint: "Browse and pick" },
      { label: "✏️  Enter path manually", value: "manual", hint: "Type the path" },
      { label: "📄 Use paths file", value: "file", hint: "Load from JSON" },
    ],
  });

  if (typeof mode === "symbol") {
    throw new Error("Selection cancelled");
  }

  return mode as PathSelectionMode;
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
 * Prompt user to select refs directories
 */
export async function selectRefs(cwd: string): Promise<string[]> {
  const mode = await askSelectionMode("refs (reference material)");

  if (mode === "manual") {
    const input = await consola.prompt(
      "Enter refs paths (comma-separated):",
      { type: "text", placeholder: "./src, ./lib" }
    );
    if (typeof input === "symbol") throw new Error("Selection cancelled");
    return input
      .split(",")
      .map((p) => resolve(cwd, p.trim()))
      .filter(Boolean);
  }

  if (mode === "select") {
    const dirs = await listDirectories(cwd);
    if (dirs.length === 0) {
      consola.warn("No directories found in current directory");
      return selectRefs(cwd); // retry
    }

    const selected = await consola.prompt("Select refs directories:", {
      type: "multiselect",
      options: dirs.map((d) => ({ label: `📁 ${d}`, value: d, hint: "source" })),
    });

    if (typeof selected === "symbol") throw new Error("Selection cancelled");
    return (selected as string[]).map((d) => resolve(cwd, d));
  }

  // file mode - will be handled at config level
  throw new Error("Use loadPathsFile for file-based configuration");
}

/**
 * Prompt user to select a rules file
 */
export async function selectRules(cwd: string): Promise<string> {
  const mode = await askSelectionMode("rules file");

  if (mode === "manual") {
    const input = await consola.prompt("Enter rules file path:", {
      type: "text",
      placeholder: "./rules.md",
    });
    if (typeof input === "symbol") throw new Error("Selection cancelled");
    return resolve(cwd, input.trim());
  }

  if (mode === "select") {
    const files = await listFilesRecursive(cwd, [".mdc", ".md"]);
    if (files.length === 0) {
      consola.warn("No .mdc or .md files found");
      return selectRules(cwd); // retry
    }

    // Show relative paths for readability
    const options = files.map((f) => ({
      label: `📄 ${f.replace(cwd + "/", "")}`,
      value: f,
      hint: f.endsWith(".mdc") ? "cursor rules" : "markdown",
    }));

    const selected = await consola.prompt("Select rules file:", {
      type: "select",
      options,
    });

    if (typeof selected === "symbol") throw new Error("Selection cancelled");
    return selected as string;
  }

  throw new Error("Use loadPathsFile for file-based configuration");
}

/**
 * Prompt user to select output directory
 */
export async function selectOutput(cwd: string): Promise<string> {
  const mode = await askSelectionMode("output directory");

  if (mode === "manual") {
    const input = await consola.prompt("Enter output directory path:", {
      type: "text",
      default: "./docs",
    });
    if (typeof input === "symbol") throw new Error("Selection cancelled");
    return resolve(cwd, input.trim());
  }

  if (mode === "select") {
    const dirs = await listDirectories(cwd);
    const options = [
      { label: "✨ Create new directory", value: "__new__", hint: "Will be created" },
      ...dirs.map((d) => ({ label: `📁 ${d}`, value: d })),
    ];

    const selected = await consola.prompt("Select output directory:", {
      type: "select",
      options,
    });

    if (typeof selected === "symbol") throw new Error("Selection cancelled");

    if (selected === "__new__") {
      const newDir = await consola.prompt("Enter new directory name:", {
        type: "text",
        default: "docs",
      });
      if (typeof newDir === "symbol") throw new Error("Selection cancelled");
      return resolve(cwd, newDir.trim());
    }

    return resolve(cwd, selected as string);
  }

  throw new Error("Use loadPathsFile for file-based configuration");
}

/**
 * Check if a paths file exists and offer to use it
 */
export async function checkForPathsFile(cwd: string): Promise<string | null> {
  const candidates = ["ralph.paths.json", ".ralph.paths.json", "paths.json"];

  for (const candidate of candidates) {
    const filePath = join(cwd, candidate);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const useIt = await consola.prompt(
        `Found ${candidate}. Use it for configuration?`,
        { type: "confirm", initial: true }
      );
      if (useIt === true) {
        return filePath;
      }
    }
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

  // Check rules file
  const rulesFile = Bun.file(config.rules);
  if (!(await rulesFile.exists())) {
    throw new Error(`Rules file does not exist: ${config.rules}`);
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
      rules: resolve(cwd, loaded.rules),
      output: resolve(cwd, loaded.output),
    };
  }

  // Interactive selection
  const refs = await selectRefs(cwd);
  const rules = await selectRules(cwd);
  const output = await selectOutput(cwd);

  return { refs, rules, output };
}
