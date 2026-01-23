# cralph

<p align="center">
  <img src="https://raw.githubusercontent.com/mguleryuz/cralph/main/assets/ralph.png" alt="Ralph cooking" width="500">
</p>

Claude in a loop. Give it a TODO, let it cook.

```
.ralph/
├── refs/             (read-only reference material)
├── TODO.md ──loop──> ./
└── paths.json        (output)
```

## What is Ralph?

[Ralph](https://ghuntley.com/ralph/) is a technique: run Claude in a loop until it signals completion.

```bash
while :; do cat PROMPT.md | claude -p ; done
```

cralph wraps this into a CLI with config, logging, and TODO tracking.

## Install

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install cralph
bun add -g cralph
```

## Quick Start

```bash
# In any directory without .ralph/ - creates starter structure
cralph

# Run again - prepare your TODO, then run
cralph
```

## Usage

```bash
# Auto-detects .ralph/paths.json in cwd
cralph

# Override with flags
cralph --refs ./source --output .

# Auto-confirm prompts (CI/automation)
cralph --yes
```

## How It Works

1. Checks Claude CLI auth (cached for 6 hours)
2. Looks for `.ralph/` in current directory
3. Shows main menu: **Run** / **Prepare TODO** / **Edit config**
4. If no `TODO.md` exists, prompts you to describe your goal before starting
5. Runs `claude -p --dangerously-skip-permissions` in a loop
6. Claude completes **ONE task per iteration**, marks it done, then stops
7. Auto-commits progress after each iteration (fails gracefully if no git)
8. Stops when Claude outputs `<promise>COMPLETE</promise>`

## Main Menu

When `.ralph/paths.json` exists, you get:

```
❯ Found .ralph/paths.json. What would you like to do?
● 🚀 Run with this config
○ 📝 Prepare TODO
○ ✏️  Edit configuration
```

- **Run** — validates config, prompts for TODO if missing, then starts the loop
- **Prepare TODO** — describe your tasks, Claude generates TODO.md, returns to menu
- **Edit** — re-select refs/output, save config, returns to menu

## Prepare TODO

Selecting **Prepare TODO** prompts you to describe what Claude should work on:

```
? Describe your tasks (what should Claude work on?):
> Build a REST API with user auth, add unit tests, setup error handling
```

Claude generates a structured TODO.md with ordered, actionable tasks:

```markdown
# Tasks

- [ ] Set up Express server with basic routing
- [ ] Add user authentication with JWT
- [ ] Create user CRUD endpoints
- [ ] Add error handling middleware
- [ ] Write unit tests for auth module
- [ ] Write unit tests for user endpoints

---

# Notes

_Append progress and learnings here after each iteration_
```

You can prepare TODO multiple times — each run overwrites the previous.

## Config

```json
{
  "refs": ["./.ralph/refs"],
  "output": "."
}
```

Save as `.ralph/paths.json`. Refs are optional reference material (read-only).

## Files

| File | Description |
|------|-------------|
| `.ralph/paths.json` | Configuration (refs, output) |
| `.ralph/refs/` | Optional reference material (read-only) |
| `.ralph/TODO.md` | Task tracking (generated or manual, updated by Claude) |
| `.ralph/ralph.log` | Session log |
| `~/.cralph/auth-cache.json` | Auth cache (6h TTL) |

### TODO Format

Claude maintains this structure (one task per iteration):

```markdown
# Tasks

- [ ] Pending task
- [x] Completed task

---

# Notes

## Task 1 - Done
- What was implemented
- Files changed
- Learnings: patterns discovered, gotchas encountered
```

## First Run (No .ralph/ in cwd)

```
❯ No .ralph/ found in /path/to/dir
● 📦 Create starter structure
○ ⚙️  Configure manually
```

Select **Create starter structure** to generate the default config:

```
ℹ Created .ralph/refs/ directory
ℹ Created .ralph/paths.json

╭──────────────────────────────────────────────╮
│  1. Add source files to .ralph/refs/         │
│  2. Run cralph again to prepare your TODO    │
╰──────────────────────────────────────────────╯
```

## TODO Reset

When running, if TODO.md has existing progress:

```
? Found existing TODO with progress. Reset to start fresh? (y/N)
```

Default is **No** — continues with existing progress.

## Path Selection

- **Space** — Toggle selection
- **Enter** — Confirm
- **Ctrl+C** — Exit

## Platform Support

cralph works on **macOS**, **Linux**, and **Windows** with platform-specific handling:

| Platform | Protected Directories Skipped |
|----------|------------------------------|
| macOS    | Library, Photos Library, Photo Booth Library |
| Linux    | lost+found, proc, sys |
| Windows  | System Volume Information, $Recycle.Bin, Windows |

Permission errors (`EPERM`, `EACCES`) are handled gracefully on all platforms.

## Testing

```bash
bun test
```

- **Unit tests** — Config, prompt building, CLI, access error handling, platform detection, shutdown state
- **E2E tests** — Full loop with Claude (requires auth)

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## Warning

Runs with `--dangerously-skip-permissions`. Review output regularly.

## Resources

- [Ralph / Geoff Huntley](https://ghuntley.com/ralph/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
