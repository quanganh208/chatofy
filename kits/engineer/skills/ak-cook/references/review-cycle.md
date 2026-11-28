# Review cycle

Review the current revision against acceptance, affected callers, public contracts, security
and repository conventions. Record concrete findings with evidence and severity; a numeric
score is not proof.

Outside explicit `--interactive`, repair supported findings within authorized scope and
rerun only checks affected by the repair. Never approve unresolved required checks. If
repeated attempts produce no progress, report evidence and the smallest missing decision.

In explicit `--interactive`, present findings and wait for the user's review at each major
checkpoint. A request to accept a finding cannot override repository or safety requirements.
Under `--advice`, consult the supervisor on a failed verification before re-diagnosis or edits.
