# cralph

<p align="center">
  <img src="assets/ralph.png" alt="Ralph cooking" width="500">
</p>

Claude in a loop. Give it a rule, let it cook.

```
.ralph/
├── rule.md ──loop──> ./
├── refs/             (output)
└── TODO.md
```

## What is Ralph?

[Ralph](https://ghuntley.com/ralph/) is a technique: run Claude in a loop until it signals completion.

```bash
while :; do cat PROMPT.md | claude -p ; done
```

cralph wraps this into a CLI with config, logging, and TODO tracking.

## Install

```bash
bun add -g cralph
```

Or with npm:

```bash
npm install -g cralph
```

## Quick Start

```bash
# In an empty directory - creates starter structure
cralph

# Edit rule.md with your instructions, then run again
cralph
```

## Usage

```bash
# Auto-detects .ralph/paths.json in cwd
cralph

# Override with flags
cralph --refs ./source --rule ./rule.md --output .

# Auto-confirm prompts (CI/automation)
cralph --yes
```

## How It Works

1. Checks Claude CLI auth (cached for 6 hours)
2. Loads config from `.ralph/paths.json`
3. Runs `claude -p --dangerously-skip-permissions` in a loop
4. Claude updates `.ralph/TODO.md` after each iteration
5. Stops when Claude outputs `<promise>COMPLETE</promise>`

## Config

```json
{
  "refs": ["./.ralph/refs"],
  "rule": "./.ralph/rule.md",
  "output": "."
}
```

Save as `.ralph/paths.json`. Refs are optional reference material (read-only).

## Files

| File | Description |
|------|-------------|
| `.ralph/paths.json` | Configuration |
| `.ralph/rule.md` | Your instructions for Claude |
| `.ralph/refs/` | Optional reference material (read-only) |
| `.ralph/TODO.md` | Task tracking (updated by Claude) |
| `.ralph/ralph.log` | Session log |
| `~/.cralph/auth-cache.json` | Auth cache (6h TTL) |

### TODO Format

Claude maintains this structure:

```markdown
# Tasks

- [ ] Pending task
- [x] Completed task

# Notes

Any relevant context
```

## First Run (Empty Directory)

```
ℹ Created .ralph/refs/ directory
ℹ Created .ralph/rule.md with starter template
ℹ Created .ralph/paths.json

╭──────────────────────────────────────────────╮
│ 1. Add source files to .ralph/refs/          │
│ 2. Edit .ralph/rule.md with your instructions│
│ 3. Run cralph again                          │
╰──────────────────────────────────────────────╯
```

## Prompts

**Config detected:**
```
❯ Found .ralph/paths.json. What would you like to do?
● 🚀 Run with this config
○ ✏️  Edit configuration
```

**TODO has progress:**
```
? Found existing TODO with progress. Reset to start fresh? (Y/n)
```

## Path Selection

- **Space** - Toggle selection
- **Enter** - Confirm
- **Ctrl+C** - Exit

## Testing

```bash
bun test
```

- **Unit tests** - Config, prompt building, CLI
- **E2E tests** - Full loop with Claude (requires auth)

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## Warning

Runs with `--dangerously-skip-permissions`. Review output regularly.

## Resources

- [Ralph / Geoff Huntley](https://ghuntley.com/ralph/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
