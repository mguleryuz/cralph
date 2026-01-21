#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import { resolve, join } from "path";
import { mkdir } from "fs/promises";
import {
  buildConfig,
  loadPathsFile,
  validateConfig,
  selectRefs,
  selectRule,
  selectOutput,
  checkForPathsFile,
} from "./paths";
import { run, cleanupSubprocess, checkClaudeAuth } from "./runner";
import type { RalphConfig } from "./types";

// Graceful shutdown on Ctrl+C
function setupGracefulExit() {
  let shuttingDown = false;
  
  process.on("SIGINT", () => {
    if (shuttingDown) {
      // Force exit on second Ctrl+C
      process.exit(1);
    }
    shuttingDown = true;
    cleanupSubprocess();
    console.log("\n");
    consola.info("Cancelled.");
    // Use setImmediate to ensure output is flushed
    setImmediate(() => process.exit(0));
  });
  
  // Also handle SIGTERM
  process.on("SIGTERM", () => {
    cleanupSubprocess();
    process.exit(0);
  });
}

const main = defineCommand({
  meta: {
    name: "cralph",
    version: "1.0.0",
    description: "Claude in a loop. Point at refs, give it a rule, let it cook.",
  },
  args: {
    refs: {
      type: "string",
      description: "Comma-separated refs paths (source material)",
      valueHint: "path1,path2",
      alias: "r",
      required: false,
    },
    rule: {
      type: "string",
      description: "Path to rule file (.mdc or .md)",
      valueHint: "rule.md",
      alias: "u",
      required: false,
    },
    output: {
      type: "string",
      description: "Output directory where results will be written",
      valueHint: ".",
      alias: "o",
      required: false,
    },
    help: {
      type: "boolean",
      description: "Show this help message",
      alias: "h",
      required: false,
    },
    yes: {
      type: "boolean",
      description: "Auto-confirm all prompts (for CI/automation)",
      alias: "y",
      required: false,
    },
  },
  async run({ args }) {
    setupGracefulExit();
    const cwd = process.cwd();
    let config: RalphConfig;

    try {
      // Check Claude authentication first - before any prompts
      consola.start("Checking Claude authentication...");
      const isAuthed = await checkClaudeAuth();
      
      if (!isAuthed) {
        consola.error("Claude CLI is not authenticated\n");
        consola.box("claude\n\nThen type: /login");
        consola.info("After logging in, run cralph again.");
        process.exit(1);
      }
      
      consola.success("Claude authenticated");

      // Check for existing paths file in cwd
      const pathsFileResult = args.yes 
        ? await checkForPathsFile(cwd, true) // Auto-run if --yes
        : await checkForPathsFile(cwd);
      
      if (pathsFileResult?.action === "run") {
        // Use existing config file
        consola.info(`Loading config from ${pathsFileResult.path}`);
        const loaded = await loadPathsFile(pathsFileResult.path);
        config = {
          refs: loaded.refs.map((r) => resolve(cwd, r)),
          rule: resolve(cwd, loaded.rule),
          output: resolve(cwd, loaded.output),
        };
      } else {
        // Load existing config for edit mode defaults
        let existingConfig: RalphConfig | null = null;
        if (pathsFileResult?.action === "edit") {
          consola.info("Edit configuration");
          const filePath = join(cwd, ".ralph", "paths.json");
          const file = Bun.file(filePath);
          if (await file.exists()) {
            const loaded = await loadPathsFile(filePath);
            existingConfig = {
              refs: loaded.refs.map((r) => resolve(cwd, r)),
              rule: resolve(cwd, loaded.rule),
              output: resolve(cwd, loaded.output),
            };
          }
        } else {
          consola.info("Interactive configuration mode");
        }

        // Interactive selection
        const refs = args.refs 
          ? args.refs.split(",").map((r) => resolve(cwd, r.trim()))
          : await selectRefs(cwd, existingConfig?.refs, args.yes);
        
        const rule = args.rule 
          ? resolve(cwd, args.rule)
          : await selectRule(cwd, existingConfig?.rule);
        
        const output = args.output 
          ? resolve(cwd, args.output)
          : await selectOutput(cwd, existingConfig?.output);

        config = { refs, rule, output };

        // Offer to save config
        const saveConfig = await consola.prompt("Save configuration to .ralph/paths.json?", {
          type: "confirm",
          initial: true,
        });

        if (saveConfig === true) {
          const ralphDir = join(cwd, ".ralph");
          await mkdir(ralphDir, { recursive: true });
          
          const pathsConfig = {
            refs: config.refs.map((r) => "./" + r.replace(cwd + "/", "")),
            rule: "./" + config.rule.replace(cwd + "/", ""),
            output: config.output === cwd ? "." : "./" + config.output.replace(cwd + "/", ""),
          };
          await Bun.write(
            join(ralphDir, "paths.json"),
            JSON.stringify(pathsConfig, null, 2)
          );
          consola.success("Saved .ralph/paths.json");
        }
      }

      // Validate configuration
      consola.info("Validating configuration...");
      await validateConfig(config);

      // Show config summary
      consola.info("Configuration:");
      consola.info(`  Refs: ${config.refs.join(", ")}`);
      consola.info(`  Rule: ${config.rule}`);
      consola.info(`  Output: ${config.output}`);
      console.log();

      // Confirm before running (skip if --yes)
      if (!args.yes) {
        const proceed = await consola.prompt("Start processing?", {
          type: "confirm",
          initial: true,
        });

        if (proceed !== true) {
          consola.info("Cancelled.");
          process.exit(0);
        }
      }

      // Run the main loop
      await run(config);
    } catch (error) {
      // Handle graceful cancellation
      if (error instanceof Error && error.message.includes("cancelled")) {
        console.log();
        consola.info("Cancelled.");
        process.exit(0);
      }
      
      if (error instanceof Error) {
        consola.error(error.message);
      } else {
        consola.error("An unexpected error occurred");
      }
      process.exit(1);
    }
  },
});

runMain(main);
