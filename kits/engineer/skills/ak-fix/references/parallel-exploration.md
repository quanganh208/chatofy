# Parallel Exploration

Delegate only large, separable work: several unrelated areas to scout, or independent issues
under `--parallel`. For a small fix, scout and verify in the main agent with `search_files`,
`read_file` and `run_shell`.

## Runtime Rules

- Use `delegate_agent` for subagents. Claude Code maps it to Task; Codex Desktop maps it to
  `multi_agent_v1.spawn_agent(agent_type="Explore", message="...")`, and if that tool is
  deferred, first use `tool_search` for multi-agent spawn tools.
- Some runtimes only allow subagents when the user's own request asked for delegation or
  parallel agent work, so a skill instruction is not by itself authorization. If delegation is
  unavailable or not permitted, do the work in the main agent.
- Give each delegate a distinct, non-overlapping scope, and launch independent delegates in
  one assistant turn when the runtime supports parallel calls.

## Parallel Issue Trees (`--parallel`)

- Create separate plan items per independent issue.
- Mark each issue's debug item as blocking its fix item.
- Add a final integration-verify item blocked by all issue fixes.
- Spawn agents per issue tree through `delegate_agent` when permitted.

Agents claim work through the live task-management surface when supported. Otherwise, the
orchestrator assigns non-overlapping scopes from the active plan and advances blocked work only
after prerequisites complete.
