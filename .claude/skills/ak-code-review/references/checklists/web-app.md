# Web App Review Checklist (Overlay)

Additive to `base.md`. Apply when `package.json` has a frontend framework dependency
(`react`, `vue`, `svelte`, `next`, `nuxt`, `angular`), the project has `src/pages/`,
`src/app/`, `src/components/` or `src/views/`, or the diff touches HTML/JSX/TSX/Vue files.

---

## Pass 1: blocking (additions to base)

### XSS
- `innerHTML` assignment from any non-static source
- Template literals interpolated into DOM without escaping
- URL parameters rendered without sanitization
- `<a href={userInput}>` without protocol validation (javascript: protocol)
- Server-rendered user content without HTML entity encoding

### CSRF
- State-changing endpoints (POST/PUT/DELETE) without CSRF token verification
- Cookie-based auth without SameSite attribute
- Form submissions to external URLs

### N+1 Queries (server-rendered views)
- Database queries inside loops rendering lists
- Sequential API calls that could be batched

---

## Pass 2: informational (additions to base)

### Frontend Performance
- Large bundle imports that could be lazy-loaded (e.g., full lodash instead of lodash/get)
- Images without width/height causing layout shift

### Accessibility
- Interactive elements without keyboard support (onClick without onKeyDown)
- Form inputs without associated labels
- Missing ARIA attributes on custom interactive components
