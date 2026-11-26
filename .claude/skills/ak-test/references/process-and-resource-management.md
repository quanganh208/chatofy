# Process and Resource Management

Test runs start servers, watchers, browsers, containers, and temporary roots.
Concurrent sessions and worktrees multiply them. This reference keeps a run from
leaving processes behind or taking another session's resources.

## Before starting

- Check whether a process for this project, worktree, and port already runs.
  Reuse it when it serves the same source and configuration; otherwise stop it
  only if this session started it.
- Bind to a deterministic port for the project or worktree. On "address in use",
  identify the owner. Stop a stale owner this session started; report one it
  does not own. Do not increment to a new port and start a duplicate.
- Prefer a temporary root per run, not a shared global path another session may
  clean up underneath you.

## While running

- Record every started resource: command, process ID, port, container, worktree,
  and temporary root.
- Prefer the runtime's background-run facility, which reports exit, over a
  detached process you cannot observe.
- Give long commands an explicit timeout, and treat a timeout as unverified, not
  as a pass.

## After the run

- Stop what this run started on success, failure, timeout, and cancellation:
  graceful stop first, hard stop only when it is ignored.
- Before a worktree or session ends, stop that worktree's processes first so
  nothing is orphaned.
- Verify cleanup: the port is free and the recorded processes are gone. Report
  cleanup that could not be verified.

## Ownership

Never stop a process that belongs to the user, another session, or the system
without confirmation, and never use a match pattern broad enough to catch an
unrelated process.
