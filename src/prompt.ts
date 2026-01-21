import type { RalphConfig } from "./types";

/**
 * The main ralph prompt template.
 * Generic prompt for any Ralph use case.
 */
const BASE_PROMPT = `You are an autonomous agent running in a loop.

FIRST: Read and internalize the rules provided below.

Your job is to follow the rules and complete the task. Write output to the output directory.

If refs paths are provided, they are READ-ONLY reference material. Never delete, move, or modify files in refs.

**IMPORTANT: At the end of EVERY iteration, update the TODO file with your progress.**
Keep the TODO structure with these sections:
- **# Tasks** - Checklist with [ ] for pending and [x] for done
- **# Notes** - Any relevant notes or context

STOPPING CONDITION: When done, update the TODO file, then output exactly:

<promise>COMPLETE</promise>

This signals the automation to stop. Only output this tag when truly done.`;

/**
 * Build the complete prompt with config and rules injected
 */
export function buildPrompt(config: RalphConfig, rulesContent: string, todoFile: string): string {
  const refsList = config.refs.length > 0 
    ? config.refs.map((r) => `- ${r}`).join("\n")
    : "_None_";

  return `${BASE_PROMPT}

---

## Configuration

**TODO file (update after each iteration):**
${todoFile}

**Refs paths (optional, read-only reference material):**
${refsList}

**Output directory:**
${config.output}

---

## Rules

${rulesContent}
`;
}

/**
 * Read rule file and build complete prompt
 */
export async function createPrompt(config: RalphConfig, todoFile: string): Promise<string> {
  const ruleFile = Bun.file(config.rule);
  const ruleContent = await ruleFile.text();

  return buildPrompt(config, ruleContent, todoFile);
}
