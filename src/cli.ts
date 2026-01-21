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
import { run } from "./runner";
import type { RalphConfig } from "./types";

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
      required: false,
    },
    rules: {
      type: "string",
      description: "Path to rules file (.mdc or .md)",
      required: false,
    },
    output: {
      type: "string",
      description: "Output directory",
      required: false,
    },
    "paths-file": {
      type: "string",
      description: "Path to configuration file (JSON)",
      required: false,
    },
  },
  async run({ args }) {
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
        consola.info("Interactive configuration mode\n");

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
