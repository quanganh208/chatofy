# Base Review Checklist

Universal checklist for all project types. Two-pass model: blocking + informational
(non-blocking).

## Instructions

Review the diff against the target branch for the issues below. Cite `file:line` and a
fix; skip anything that is fine.

**Output format:**

```
Pre-Landing Review: N issues (X critical, Y informational)

**CRITICAL** (blocking):
- [file:line] Problem description
  Fix: suggested fix

**Issues** (non-blocking):
- [file:line] Problem description
  Fix: suggested fix
```

If no issues: `Pre-Landing Review: No issues found.`

One line problem, one line fix. No preamble.

---

## Pass 1: blocking

### Injection & Data Safety
- String interpolation in SQL/database queries (even with type casting — use parameterized queries)
- Unsanitized user input written to database or rendered in HTML
- Raw HTML output from user-controlled data (`innerHTML`, `dangerouslySetInnerHTML`, `html_safe`, `raw()`, `| safe`)
- Command injection via string concatenation in shell commands (use argument arrays)
- Path traversal via user input in file operations

### Race Conditions & Concurrency
- Read-check-write without atomic operations (check-then-set should be atomic WHERE + UPDATE)
- Find-or-create without unique database constraint (concurrent calls create duplicates)
- Status transitions without atomic WHERE old_status + UPDATE new_status
- Shared mutable state accessed without synchronization

### Security Boundaries
- Missing authentication or authorization checks on new endpoints/routes (authenticated but not authorized, admin-only operations open to regular users)
- Privilege escalation paths (user can access/modify another user's data — IDOR)
- Secrets in logs, error responses, or client-side code
- LLM/AI output written to database or used in queries without validation
- JWT/token comparison using `==` instead of constant-time comparison
- Session fixation or token reuse defects

---

## Pass 2: informational

### Conditional Side Effects
- Code branches on condition but forgets side effect on one branch (e.g., sets status but not associated data)
- Log messages claiming action happened but action was conditionally skipped

### Coupling & Staleness
- Error message strings used as query filters elsewhere (grep for the string)
- Stale comments describing old behavior after code changed

### Test Gaps
- Missing negative-path tests (error cases, validation failures)
- Assertions on type/status but not side effects (e.g., checks status but not that email was sent)
- Missing integration tests for security enforcement (auth, rate limiting, access control)

### Type Coercion at Boundaries
- Values crossing language/system boundaries where type could change (string vs number)
- Hash/digest inputs that don't normalize types before serialization

### Performance
- O(n*m) lookups in views/templates (array search inside loops — use hash/map lookup)
- N+1 queries: loading associations inside loops without eager loading
- Unbounded queries or list endpoints without LIMIT or pagination

---

## Suppressions: do not flag these

- Redundancy that aids readability (e.g., `present?` redundant with length check)
- "Add comment explaining why this threshold was chosen" — thresholds change, comments rot
- "This assertion could be tighter" when assertion already covers the behavior
- Consistency-only changes (wrapping a value to match how another constant is guarded)
- Harmless no-ops (e.g., `.filter()` on array that never contains the filtered value)
- Anything already addressed elsewhere in the diff being reviewed
- Style, formatting, naming, unused imports or variables, and magic numbers (linters own these)
- "Consider using X instead of Y" when Y works fine
