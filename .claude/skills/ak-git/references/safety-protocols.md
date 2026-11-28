# Git Safety Protocols

## Secret Detection

A keyword match alone is not a secret (see `workflow-commit.md`). Detect value-shaped
credentials and block only those.

### Scan Command
Prefer an installed scanner on the staged diff with values redacted, for example
`gitleaks protect --staged --redact`. Otherwise scan the staged files:
```bash
git diff --cached --name-only -z --diff-filter=ACMR \
  | xargs -0 git grep --cached -nE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(^|[^A-Za-z0-9])sk-(proj-|live_|test_)?[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|[a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]+@)' -- \
  | cut -d: -f1,2
```
`cut` keeps only `file:line`, so no matched value is echoed; never print one.

### Value Shapes to Detect

| Category | Shape |
|----------|-------|
| AWS access key id | `AKIA` + 16 uppercase letters/digits |
| Private keys | `-----BEGIN ... PRIVATE KEY-----` header |
| Provider tokens | GitHub `ghp_`/`gho_`/`ghs_`/`github_pat_`, Slack `xox?-`, `sk-` API keys, Google `AIza` |
| Credentials in URLs | `scheme://user:password@host` |

Keywords such as `api_key`, `token`, `password` or `secret` in code, tests or generated
files are not findings by themselves; flag them only when an assigned literal is a real
credential.

### Files to Warn About
- `.env`, `.env.*` (except `.env.example`)
- `*.key`, `*.pem`, `*.p12`
- `credentials.json`, `secrets.json`
- `config/private.*`

### Action on Detection
1. Check each hit's context once; dismiss placeholders, test fixtures and keyword-only matches.
2. For a real credential, **block the commit** and report `file:line` with the value redacted.
3. Suggest: "Add to .gitignore or use environment variables / a secret store"
4. Offer to unstage: `git reset HEAD <file>`

## Branch Protection

### Never Force Push To
- `main`, `master`, `production`, `prod`, `release/*`

### Pre-Merge Checks
```bash
# Check for conflicts before merge
git merge --no-commit --no-ff origin/{branch} && git merge --abort
```

### Remote-First Operations
Always use `origin/{branch}` for comparisons:
- ✅ `git diff origin/main...origin/feature`
- ❌ `git diff main...HEAD` (includes local uncommitted)

## Error Recovery

### Undo Last Commit (unpushed)
```bash
git reset --soft HEAD~1  # Keep changes staged
git reset HEAD~1         # Keep changes unstaged
```

### Abort Merge
```bash
git merge --abort
```

### Discard Local Changes
```bash
git checkout -- <file>   # Single file
git reset --hard HEAD    # All files (DANGER)
```

**Always confirm with user before destructive operations.**
