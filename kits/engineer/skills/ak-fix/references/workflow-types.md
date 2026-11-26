# Type Error Fix Workflow

Quick workflow for TypeScript/type errors. Run the project's typecheck (`bun run typecheck`,
`tsc --noEmit` or `npx tsc --noEmit`) until it reports zero errors, grouping errors that share
a cause.

Do not use `any` to make an error pass; it hides the defect the checker found. Use the proper
type, a `@types/*` package, or `unknown` with a type guard.
