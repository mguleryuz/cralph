import type { RalphConfig } from "./types";

/**
 * The main ralph prompt template.
 * Based on ralph-ref best practices for autonomous agent loops.
 */
const BASE_PROMPT = `You are an autonomous coding agent running in a loop.

## Your Task This Iteration

1. Read the TODO file
2. Pick the FIRST uncompleted task (marked with [ ])
3. Implement that SINGLE task
4. Run quality checks (typecheck, lint, test - whatever the project requires)
5. If checks pass, mark the task [x] complete
6. Append your progress to the Notes section
7. **STOP** - End your response. Another iteration will handle the next task.

## Critical Rules

- **ONE task per iteration** - Complete exactly ONE task, then STOP. Do NOT continue to the next task.
- **Quality first** - Do NOT mark a task complete if tests/typecheck fail
- **Keep changes focused** - Minimal, targeted changes only
- **Follow existing patterns** - Match the codebase style

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

After completing ONE task, check the TODO file:

- If there are still tasks marked [ ] (pending): **END your response normally.** Another iteration will pick up the next task.

- If ALL tasks are marked [x] (complete): Output exactly:

<promise>COMPLETE</promise>

**IMPORTANT:** Do NOT continue to the next task. Complete ONE task, then STOP.`;

/**
 * Build the complete prompt with config injected
 */
export function buildPrompt(config: RalphConfig, todoFile: string): string {
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
`;
}

/**
 * Build the complete prompt from config
 */
export async function createPrompt(config: RalphConfig, todoFile: string): Promise<string> {
  return buildPrompt(config, todoFile);
}
