import type { RalphConfig } from "./types";

/**
 * The main ralph prompt template.
 * Based on ralph-ref best practices for autonomous agent loops.
 */
const BASE_PROMPT = `You are an autonomous coding agent running in a loop.

FIRST: Read and internalize the rules provided below.

## Your Task Each Iteration

1. Read the TODO file
2. Pick the FIRST uncompleted task (marked with [ ])
3. Implement that SINGLE task
4. Run quality checks (typecheck, lint, test - whatever the project requires)
5. If checks pass, mark the task [x] complete
6. Append your progress to the Notes section (see format below)
7. If ALL tasks are complete, output the completion signal

## Critical Rules

- **ONE task per iteration** - Do not try to complete multiple tasks
- **Quality first** - Do NOT mark a task complete if tests/typecheck fail
- **Keep changes focused** - Minimal, targeted changes only
- **Follow existing patterns** - Match the codebase style
- **Commit after completing** - Commit your changes with a meaningful message

## Commit Format

After completing a task and quality checks pass, commit ALL changes with:

\`\`\`
feat: [Task Title]
\`\`\`

Use \`feat:\` for new features, \`fix:\` for bug fixes, \`refactor:\` for refactoring, \`docs:\` for documentation.

## Progress Format

After completing a task, APPEND to the Notes section:

\`\`\`
## [Task Title] - Done
- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered
\`\`\`

## Refs (Read-Only)

If refs paths are provided, they are READ-ONLY reference material. Never modify files in refs.

## Stop Condition

After completing a task, check if ALL tasks are marked [x] complete.

If ALL tasks are done, output exactly:

<promise>COMPLETE</promise>

If there are still pending tasks, end your response normally (the loop will continue).`;

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

**TODO file (read first, update after each task):**
${todoFile}

**Refs (read-only reference material):**
${refsList}

**Output directory (write your work here):**
${config.output}

---

## Rules (Your Instructions)

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
