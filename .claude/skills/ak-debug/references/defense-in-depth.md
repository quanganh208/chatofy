# Defense-in-Depth Validation

After the root cause is fixed, decide whether more validation layers are warranted. A single
check can be bypassed by another code path, a refactor or a mock, so consider each layer the
bad data passed through, and add a check only where it discriminates between plausible causes
or protects the repaired contract.

| Layer | Purpose | Example |
|---|---|---|
| Entry point | Reject obviously invalid input at the API boundary | `createProject` throws on an empty, missing or non-directory `workingDirectory` |
| Business logic | Ensure the data makes sense for this operation | `initializeWorkspace` requires `projectDir` |
| Environment guard | Refuse dangerous operations in specific contexts | Under `NODE_ENV === 'test'`, refuse `git init` outside `tmpdir()` |
| Debug instrumentation | Capture context for forensics | Log `directory`, `process.cwd()` and a stack before `git init` |

To apply it: trace where the bad value originates and where it is used, list the checkpoints
it passes, choose the layers that earn a check, and test each one by bypassing the layer above
it.
