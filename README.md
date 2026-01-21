# cralph

<p align="center">
  <img src="assets/ralph.png" alt="Ralph cooking" width="500">
</p>

Claude in a loop. Point at refs, give it a rule, let it cook.

```
refs/  ──loop──>  ./
(source)   │      (output in cwd)
           │
        rule.md
```

## What is Ralph?

[Ralph](https://ghuntley.com/ralph/) is a technique: run Claude in a loop until it signals completion.

```bash
while :; do cat PROMPT.md | claude -p ; done
```

cralph wraps this into a CLI with path selection and logging.

## Install

```bash
bun add -g cralph
```

Or with npm:

```bash
npm install -g cralph
```

## Usage

```bash
# Run - auto-detects ralph.paths.json in cwd
cralph

# First run (no config) - interactive mode generates ralph.paths.json
cralph

# Override with flags
cralph --refs ./source --rule ./rule.md --output .
```

## Path Selection

Simple multiselect for all paths:

- **Space** to toggle selection
- **Enter** to confirm
- **Ctrl+C** to exit
- Shows all directories up to 3 levels deep
- Pre-selects current values in edit mode

## Config File

```json
{
  "refs": ["./refs", "./more-refs"],
  "rule": "./.cursor/rules/my-rules.mdc",
  "output": "."
}
```

Name it `ralph.paths.json` and cralph auto-detects it. Output is typically `.` (current directory) since you'll run cralph in your repo.

## How It Works

1. Reads your source material from `refs/`
2. Injects your rules into the prompt
3. Runs `claude -p --dangerously-skip-permissions` in a loop
4. Stops when Claude outputs `<promise>COMPLETE</promise>`

## Expected Behavior

**Auto-detect existing config:**
```
❯ Found ralph.paths.json. What would you like to do?
● 🚀 Run with this config
○ ✏️  Edit configuration
```

**Interactive Mode (no config file):**
```
ℹ Interactive configuration mode

↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit
❯ Select refs directories:
◻ 📁 src
◻ 📁 src/components
◼ 📁 docs

↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit
❯ Select rule file:
● 📄 .cursor/rules/my-rules.mdc (cursor rule)
○ 📄 README.md

↑↓ Navigate • Space Toggle • Enter • Ctrl+C Exit
❯ Select output directory:
● 📍 Current directory (.)
○ 📁 docs
```

**Save config after selection:**
```
? Save configuration to ralph.paths.json? (Y/n)
✔ Saved ralph.paths.json
```

**Cancellation:**
- Press `Ctrl+C` at any time to exit
- Running Claude processes are terminated cleanly

**Output Files:**
- `.ralph/ralph.log` - Session log with timestamps
- `.ralph/TODO.md` - Agent status tracker

## Testing

```bash
bun test
```

Tests validate config loading, prompt building, and CLI behavior without calling Claude.

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## Warning

Runs with `--dangerously-skip-permissions`. Review output regularly.

## Resources

- [Ralph / Geoff Huntley](https://ghuntley.com/ralph/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
