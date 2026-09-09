# Session Protocol — keeping one session inside its window

Mechanical procedure for an agent running a long task. It assumes nothing about the
model: every step is a check the agent can perform, not a judgment it must get right.
Bands are keyed to context utilization as the runtime reports it; when no number is
available, count tool calls (Yellow after 20, Orange after 40).

## Know your defaults (where the budget goes)

- **Whole-file reflex**: opening a 900-line file to find one function. Costs 8–10k tokens;
  a search plus a 40-line range costs under 1k.
- **Output carry**: a full test run or install log lands in context and stays there for
  the rest of the session, even though only the failing line mattered.
- **Re-read to remember**: opening the same file a third time because the first two reads
  were not written down.
- **Narration**: "Now I will…" before each step and "I have now…" after it. Zero
  information, paid twice per step.
- **Speculative loading**: three references and two skills loaded "in case".
- **Late checkpoint**: nothing written down until auto-compaction fires mid-edit; the
  summary keeps the wrong things.

## Band procedure

### Green (0–50%)

1. Start a ledger in your working note (plan file or work-context path). Format:
   `OBSERVED path:line – fact` or `DERIVED – conclusion (from which observations)`.
2. Search before read. Read ranges. Note after every read.
3. Trim outputs from the first command, not from the first warning.

### Yellow (50–70%)

1. Whole-file reads stop. Use the estimate script when a file's size is unknown.
2. Every command gets a limiter: `| tail -n 40`, `| head -n 40`, a pattern filter, or a
   test name.
3. No new reference or skill loads unless the current step cannot proceed without it.
4. Re-anchor: re-read your ledger (not the files) and confirm the next step.

### Orange (70–85%)

1. Finish the atomic step in flight (an edit plus its narrow check). Do not start the
   next one.
2. Write or merge the checkpoint note (six sections; template in `SKILL.md`). Content:
   current state only. Verified facts marked as such; everything else under Open Items.
3. Choose: **compact** when the task continues in this session; **hand off** when the
   session, model, or runtime changes, or when the remaining work is more than one window.
4. Compact with a focus instruction naming what to keep:

   ```text
   /compact Keep: session intent, files touched with line refs, decisions with reasons,
   verified commands and results, open items, next step. Drop: exploration output,
   superseded attempts, file contents already reflected in edits.
   ```

5. After compaction: read the checkpoint note, verify one load-bearing fact with the
   narrowest check (the failing test still fails; the edited file still contains the
   edit), then continue from Next Step.

### Red (85%+)

1. Start no new investigation, no new sub-agent, no new file read beyond what the
   checkpoint needs.
2. Write the checkpoint note if it does not exist. Carry only OBSERVED facts; unverified
   claims go under Open Items so the successor re-checks them.
3. Compact, or open a fresh session and paste the note as the first message.

## Hygiene examples (bad → good)

| Situation | Wasteful | Efficient |
|-----------|----------|-----------|
| Find a function | open the whole file | search the symbol; read 30 lines around the hit |
| Understand a module | list every file recursively | list one level; read the entry file's exports |
| Run tests | whole suite, full output | one test file, `\| tail -n 40`; whole suite only after a shared contract changed |
| Inspect a diff | whole-repo diff | `git diff --stat`, then one file's diff |
| Read a log | full log | pattern filter for the error, then 20 lines of context |
| Check a JSON config | print the file | query one key with a one-line script or a filter |
| Confirm an edit landed | re-open the file | read the edited range only, or run the narrow test |
| Learn a library API | fetch the full docs page | fetch one section or search for the signature |
| Report progress | "I have now read X, next I will…" | three lines at a milestone; outcome first |
| Ask a sub-agent | paste the transcript | the delegation packet from `SKILL.md` |

## Ledger and checkpoint mechanics

- The ledger is the cache. Consult it before any read; a fact already in it is not
  re-fetched.
- Ledger lines are short and typed. `OBSERVED` came from a tool result you saw.
  `DERIVED` is your inference. `REPORTED` came from a sub-agent or a document and is not
  yet verified.
- The checkpoint note is the ledger reorganized into the six sections. Merge new content
  into existing sections; do not rewrite the note from scratch each time (regeneration
  drifts and drops artifacts).
- Artifact trail is the weakest dimension in compaction studies. Always list exact file
  paths, function names, error strings, and test names; those are what a successor cannot
  guess.

## Compact or hand off?

| Signal | Action |
|--------|--------|
| Same session, task continues, one more window is enough | compact with focus instruction |
| Switching model, runtime, or session; or work exceeds one more window | hand off (`ak:handoff` when installed; else the checkpoint note) |
| Context is poisoned (persistent wrong belief survives correction) | fresh session from the note; carry OBSERVED facts only |
| Runtime has no compaction command | fresh session from the note |

## Sub-agents and context

- Delegate to keep large reads out of your window (scans, bulk transforms, independent
  review), not to have something to do while waiting.
- The packet carries decisions, not history. A delegate never saw the conversation;
  "as discussed" is an empty string to it.
- Ask for a bounded report: outcome, evidence lines, status line. Long reports re-import
  the context you delegated away.
- Verify load-bearing claims yourself with the narrowest check before acting on them.

## Self-check (evidence, not feelings)

| Question | Evidence |
|----------|----------|
| Did every file read above 2k tokens go through search first? | the list of reads |
| Did every command carry a limiter? | the command log |
| Is there a ledger line for each read? | the note |
| Was the checkpoint written at Orange? | note timestamp vs utilization |
| After compaction, was one fact re-verified before continuing? | the first command after compaction |
| Did any sub-agent receive history instead of a packet? | the spawn prompt |

## Do / Don't

| Don't | Instead |
|-------|---------|
| Open files to remember what they said | Keep the ledger; read once |
| Carry full tool output forward | Extract the relevant lines; trim at the command |
| Wait for auto-compaction | Checkpoint at Orange; compact with a focus instruction |
| Regenerate the checkpoint note | Merge into existing sections |
| Load references in case | Load one per distinct question, when it blocks the step |
| Trust "tests pass" from a delegate | Run the narrowest test yourself |
