# Log & CI/CD Analysis

## GitHub Actions

```bash
gh run list --limit 10                      # recent runs
gh run list --workflow=ci.yml --limit 5     # one workflow
gh run view <run-id>                        # step-by-step status
gh run view <run-id> --log-failed           # failed job logs only
gh run view <run-id> --log > /tmp/ci-full.txt
gh api repos/{owner}/{repo}/check-runs/{id}/annotations
gh run rerun <run-id> --failed
```

| Pattern | Likely cause | Investigation |
|---------|-------------|---------------|
| Passes locally, fails CI | Environment difference | Node/Python version, OS, env vars |
| Intermittent failures | Races, shared state, flaky tests | Run 3x, check timing and shared state |
| Timeouts | Resource limits, infinite loops | Resource usage, timeouts |
| Permission errors | Token or secret misconfiguration | `GITHUB_TOKEN`, secret names |
| Dependency install fails | Registry issues, version conflicts | Lockfile, registry status |
| Build succeeds, tests fail | Test environment setup | Test config, database setup, fixtures |

## Server and Application Logs

Narrow to the incident window, correlate request IDs across services, and align timestamps
across sources (watch time zones) to build a timeline from first error to user impact. Error
shape points at the cause: a sudden spike suggests a deployment, config change or dependency
failure; a gradual increase suggests a leak or data growth; periodic failures suggest cron jobs
or contention; one endpoint suggests a code or data issue; all endpoints suggest
infrastructure, database or network.

```bash
psql -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
psql -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```

Keep exact error messages, stack traces, timestamps, request IDs, normal-versus-error
comparisons and counts for the diagnostic report.
