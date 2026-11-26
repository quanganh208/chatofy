# Research & Analysis Phase

Skip this phase when researcher reports are provided.

- Split separable research questions across `researcher` agents in parallel
  and wait for all reports before synthesis.
- Use `ak-docs-seeker` for current library, framework, and llms.txt
  documentation, and `gh` for relevant issues, pull requests, and Actions logs.
- For a GitHub repository URL, generate a fresh codebase summary with
  `repomix --remote <github-repo-url>`.
- Delegate root-cause analysis of a bug to the `debugger` agent.
