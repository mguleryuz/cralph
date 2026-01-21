import type { RalphConfig } from "./types";

/**
 * The main ralph prompt template.
 * Generic prompt for any Ralph use case.
 */
const BASE_PROMPT = `You are an autonomous agent running in a loop.

FIRST: Read and internalize the rules provided below.

Your job is to process source material from the refs paths into the output directory.

**CRITICAL: refs paths are READ-ONLY.** Never delete, move, or modify files in refs. Only create files in the output directory.

Follow the rules to determine how to process each file. Track what you've done to avoid duplicate work.

STOPPING CONDITION: When all source files have been processed according to the rules, output exactly:

<promise>COMPLETE</promise>

This signals the automation to stop. Only output this tag when truly done.`;

/**
 * Build the complete prompt with config and rules injected
 */
export function buildPrompt(config: RalphConfig, rulesContent: string): string {
  const refsList = config.refs.map((r) => `- ${r}`).join("\n");

  return `${BASE_PROMPT}

---

## Configuration

**Refs paths (read-only source material):**
${refsList}

**Output directory:**
${config.output}

---

## Rules

The following rules define how to classify, refine, and write documentation:

${rulesContent}
`;
}

/**
 * Read rule file and build complete prompt
 */
export async function createPrompt(config: RalphConfig): Promise<string> {
  const ruleFile = Bun.file(config.rule);
  const ruleContent = await ruleFile.text();

  return buildPrompt(config, ruleContent);
}
