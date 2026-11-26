# Diagnosis and Verification Gates

<HARD-GATE-EXACT-ROOT-CAUSE>
Propose a fix only when each of these has a concrete one-sentence answer:

1. **Exact symptom**: the error message, failing assertion or observed behavior, copied verbatim.
2. **Reproduction steps**: the minimal commands, inputs and environment that trigger it.
3. **Expected vs actual**: what should happen and what does happen.
4. **Root cause** (not symptom): the specific line, missing check, race, contract violation or
   design flaw, with file:line evidence.
5. **Why now**: the change or condition that exposed it (commit, data shape, env, dependency).
6. **Blast radius**: every code path that depends on the broken behavior or shares the cause.

If an answer is vague ("probably", "I think"), run more scouting or debugging, or use the
`ask_user` capability with options grounded in scout findings (specific files, commits,
functions) to gather the missing logs, reproduction or environment.
</HARD-GATE-EXACT-ROOT-CAUSE>

<HARD-GATE-NO-SIDE-EFFECTS>
The fix is not done until it is verified side-effect-free, because a change that stops the
symptom can still break a caller it never ran. Verification proves:

1. The exact pre-fix reproduction now passes.
2. Tests in modified files and transitively affected modules pass.
3. No business logic or workflow regression in the blast radius above (run those tests, or
   walk the affected flows).
4. No new lint, type or build errors anywhere.
5. Public contracts (signatures, exported types, response shapes, DB schemas, env vars) are
   unchanged, or the change is intentional and called out.

If verification reveals a regression caused by this repair, diagnose and fix it within
scope, then rerun affected checks. Ask when repair requires changing an accepted contract,
product decision or unauthorized destructive action. Under `--advice`, obtain kongming
counsel on failed verification before re-diagnosis or edits. Preserve explicit `--review`
checkpoints. Report remaining gaps; passing a bounded check is not proof of every layer.
</HARD-GATE-NO-SIDE-EFFECTS>
