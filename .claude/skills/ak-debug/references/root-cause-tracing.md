# Root Cause Tracing

Trace a bug backward through the call chain to the original trigger, then fix at the source.
Use it when the error happens deep in execution, the stack trace is long, it is unclear where
invalid data originated, or you need to find which test or code triggers the problem.

## The Tracing Process

1. **Observe the symptom**: `Error: git init failed in /Users/jesse/project/packages/core`
2. **Find the immediate cause**: `await execFileAsync('git', ['init'], { cwd: projectDir });`
3. **Ask what called it**:
   ```typescript
   WorktreeManager.createSessionWorktree(projectDir, sessionId)
     → called by Session.initializeWorkspace()
     → called by Session.create()
     → called by test at Project.create()
   ```
4. **Keep tracing up** the values passed: `projectDir = ''`, and an empty `cwd` resolves to
   `process.cwd()`, the source directory.
5. **Find the original trigger**:
   ```typescript
   const context = setupCoreTest(); // Returns { tempDir: '' }
   Project.create('name', context.tempDir); // Accessed before beforeEach!
   ```

Fix there (here: make `tempDir` a getter that throws before `beforeEach`), then consider
validation layers (see `defense-in-depth.md`).

## Adding Stack Traces

When you cannot trace manually, instrument the suspect call and capture its stack:

```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  console.error('DEBUG git init:', { directory, cwd: process.cwd(), stack });
  await execFileAsync('git', ['init'], { cwd: directory });
}
```

Use `console.error()` in tests, because a logger may be silenced there. Run with
`npm test 2>&1 | grep 'DEBUG git init'` and look for test file names, the triggering line,
and a repeated parameter.

## Finding Which Test Causes Pollution

If something appears during tests but you do not know which test creates it, bisect with
`scripts/find-polluter.sh` (a bash script for macOS and Linux; use WSL on Windows), which runs
tests one by one and stops at the first polluter:

```bash
./scripts/find-polluter.sh '.git' 'src/**/*.test.ts'
```
