#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import {
  buildConfig,
  loadPathsFile,
  validateConfig,
  selectRefs,
  selectRules,
  selectOutput,
} from "./paths";
import { run, cleanupSubprocess } from "./runner";
import type { RalphConfig } from "./types";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// Graceful shutdown on Ctrl+C
function setupGracefulExit() {
  process.on("SIGINT", () => {
    cleanupSubprocess();
    console.log("\n");
    consola.info("Cancelled.");
    process.exit(0);
  });
}

function showKeybindings() {
  console.log();
  console.log(dim("─".repeat(50)));
  console.log(
    dim("  ↑/↓") + " Navigate  " +
    dim("Space") + " Toggle  " +
    dim("Enter") + " Confirm  " +
    dim("Ctrl+C") + " Cancel"
  );
  console.log(dim("─".repeat(50)));
  console.log();
}

const main = defineCommand({
  meta: {
    name: "cralph",
    version: "1.0.0",
    description: "Claude in a loop. Point at refs, give it rules, let it cook.",
  },
  args: {
    refs: {
      type: "string",
      description: "Comma-separated refs paths (source material)",
      valueHint: "path1,path2",
      alias: "r",
      required: false,
    },
    rules: {
      type: "string",
      description: "Path to rules file (.mdc or .md)",
      valueHint: "rules.md",
      alias: "u",
      required: false,
    },
    output: {
      type: "string",
      description: "Output directory where results will be written",
      valueHint: "./output",
      alias: "o",
      required: false,
    },
    "paths-file": {
      type: "string",
      description: "Path to configuration file (JSON)",
      valueHint: "ralph.paths.json",
      alias: "p",
      required: false,
    },
    help: {
      type: "boolean",
      description: "Show this help message",
      alias: "h",
      required: false,
    },
  },
  async run({ args }) {
    setupGracefulExit();
    const cwd = process.cwd();
    let config: RalphConfig;

    try {
      // If paths-file is provided, use it
      if (args["paths-file"]) {
        const pathsFilePath = resolve(cwd, args["paths-file"]);
        consola.info(`Loading config from ${pathsFilePath}`);
        const loaded = await loadPathsFile(pathsFilePath);
        config = {
          refs: loaded.refs.map((r) => resolve(cwd, r)),
          rules: resolve(cwd, loaded.rules),
          output: resolve(cwd, loaded.output),
        };
      }
      // If all args are provided via CLI flags
      else if (args.refs && args.rules && args.output) {
        config = {
          refs: args.refs.split(",").map((r) => resolve(cwd, r.trim())),
          rules: resolve(cwd, args.rules),
          output: resolve(cwd, args.output),
        };
      }
      // Interactive mode - some or no args provided
      else {
        consola.info("Interactive configuration mode");
        showKeybindings();

        // Use provided args or prompt for missing ones
        let refs: string[];
        if (args.refs) {
          refs = args.refs.split(",").map((r) => resolve(cwd, r.trim()));
        } else {
          refs = await selectRefs(cwd);
        }

        let rules: string;
        if (args.rules) {
          rules = resolve(cwd, args.rules);
        } else {
          rules = await selectRules(cwd);
        }

        let output: string;
        if (args.output) {
          output = resolve(cwd, args.output);
        } else {
          output = await selectOutput(cwd);
        }

        config = { refs, rules, output };
      }

      // Validate configuration
      consola.info("Validating configuration...");
      await validateConfig(config);

      // Show config summary
      consola.info("Configuration:");
      consola.info(`  Refs: ${config.refs.join(", ")}`);
      consola.info(`  Rules: ${config.rules}`);
      consola.info(`  Output: ${config.output}`);
      console.log();

      // Confirm before running
      const proceed = await consola.prompt("Start processing?", {
        type: "confirm",
        initial: true,
      });

      if (proceed !== true) {
        consola.info("Cancelled.");
        process.exit(0);
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
