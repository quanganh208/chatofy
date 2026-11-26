## Migration Notes

The legacy standalone server, renderer, and assets have been retired from this skill.
`scripts/open-dashboard.cjs` is now a thin launcher for the AgentKit dashboard, which
owns plan discovery and rendering.

Legacy flags (`--dir`, `--plans`, `--port`, `--host`, `--background`, `--foreground`)
and positional paths are accepted but ignored with a warning; run
`node scripts/open-dashboard.cjs --stop` to stop the dashboard.
