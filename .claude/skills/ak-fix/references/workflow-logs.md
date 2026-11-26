# Log Analysis Fix Workflow

For fixing issues found in application logs, read from `./logs.txt` or a project-specific
equivalent.

## Setup When Logs Are Missing

Add persistent log piping to project configuration:

- **Bash/Unix:** `command 2>&1 | tee logs.txt`
- **PowerShell:** `command *>&1 | Tee-Object logs.txt`

## Workflow

Search the logs with a small result limit, most recent errors first, and capture stack traces,
error codes, timestamps and repeated patterns. Scout the code those errors point to (see
`references/parallel-exploration.md` for delegation rules). Plan the fix only after the log
evidence and the code path agree on the root cause, then implement the smallest cause-aligned
fix. If the original symptom remains after testing, re-diagnose before changing more code.
