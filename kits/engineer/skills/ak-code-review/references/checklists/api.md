# API Review Checklist (Overlay)

Additive to `base.md`. Apply when the project exposes REST/GraphQL/gRPC APIs: route
definitions, an OpenAPI/Swagger spec, `src/routes/`, `src/api/` or `src/controllers/`
directories, or GraphQL schema files in the diff.

---

## Pass 1: blocking (additions to base)

### Auth & Rate Limiting
- Public endpoints missing rate limiting (login, registration, password reset)
- API keys or tokens exposed in URL query parameters (use headers)
- Batch/bulk endpoints without per-item authorization checks

### Input Validation
- Request body accepted without schema validation (missing Zod, Joi, Pydantic, etc.)
- Mass assignment: entire request body spread into database model
- File upload without size/type restrictions
- Array inputs without length limits (resource exhaustion via oversized requests)

### Data Exposure
- Sensitive fields in API responses (password hashes, internal IDs, tokens)
- Stack traces, internal error details or schema details in production error responses

---

## Pass 2: informational (additions to base)

### Observability
- Error paths that swallow exceptions silently
- Missing correlation/request IDs for tracing

### Versioning & Compatibility
- Breaking changes to existing response shapes without version bump
- Removed fields without deprecation notice
- Changed field types (string → number) in existing responses
