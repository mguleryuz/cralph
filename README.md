# cralph

<p align="center">
  <img src="assets/ralph.png" alt="Ralph cooking" width="500">
</p>

Claude in a loop. Point at refs, give it rules, let it cook.

```
refs/  ──loop──>  output/
(source)   │      (result)
           │
        rules.md
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
# Interactive - prompts for everything
cralph

# With flags
cralph --refs ./source --rules ./rules.md --output ./out

# With config file
cralph --paths-file ralph.paths.json
```

## Path Selection

When prompted, choose how to specify each path:

| Mode | What it does |
|------|--------------|
| Select from cwd | Pick directories/files interactively |
| Manual | Type the path |
| Paths file | Load from JSON config |

## Config File

```json
{
  "refs": ["./refs", "./more-refs"],
  "rules": "./.cursor/rules/my-rules.mdc",
  "output": "./output"
}
```

Name it `ralph.paths.json` and cralph auto-detects it.

## How It Works

1. Reads your source material from `refs/`
2. Injects your rules into the prompt
3. Runs `claude -p --dangerously-skip-permissions` in a loop
4. Stops when Claude outputs `<promise>COMPLETE</promise>`

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## Warning

Runs with `--dangerously-skip-permissions`. Review output regularly.

## Resources

- [Ralph / Geoff Huntley](https://ghuntley.com/ralph/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
