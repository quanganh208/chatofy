# MCP Transports

<!-- cruft-lint-allow: RFC 2119 keywords quoted from the specification, not local emphasis -->

Ship **stdio** (local) and **Streamable HTTP** (remote). Protocol semantics are identical across transports. One core `Server`, thin transport adapters.

**Sources:** [MCP Transports Spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [Streamable HTTP Spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [Discovery Spec](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [Patterns Spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns), [Deprecated Features](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)

## Transport selection

```ts
const transport = process.env.MCP_TRANSPORT ?? flag("--transport") ?? "stdio";
switch (transport) {
  case "stdio": await startStdio(server); break;
  case "http": await startStreamableHttp(server, { port }); break;
  case "sse": await startSse(server, { port }); break; // legacy offramp only
  default: die(`unknown transport: ${transport}`);
}
```

## stdio (local default)

Default for local agents (Claude Code, Cursor, Codex CLI). Newline-delimited JSON-RPC over stdin/stdout:
- No transport-layer OAuth — trust parent process; credentials resolved from environment/flag.
- Never write non-protocol bytes to `stdout`; all logs MUST go to `stderr`.
- Supports cancellation via `notifications/cancelled`.

## Streamable HTTP (primary remote)

The standard remote transport. Each request is an HTTP POST to a single endpoint (`/mcp`).
- Replies arrive as a direct JSON response or a request-scoped SSE stream.
- **Stateless at protocol layer:** The 2026-07-28 specification retired `Mcp-Session-Id`. Standalone `GET /mcp` returns `405 Method Not Allowed`. Streams are not resumable across disconnects.
- **Application state:** If continuity is required (e.g. multi-step transactions), mint an explicit application handle inside a tool response and accept it as a parameter in subsequent tool calls.

### Required HTTP header validation

Streamable HTTP mirrors request metadata into HTTP headers for gateway routing without body parsing.
- **Origin header validation:** Servers **MUST** validate the `Origin` header to defend against CSRF/DNS rebinding; return `403 Forbidden` on invalid origins. Local dev servers **SHOULD** bind strictly to `127.0.0.1`.
- `MCP-Protocol-Version`: e.g. `2026-07-28`.
- `Mcp-Method` & `Mcp-Name`: e.g. `tools/call` and tool name. Servers **MUST** validate header/body consistency; on mismatch, return JSON-RPC error code `-32020` (`HeaderMismatch`).
- `Mcp-Param-{Name}`: Optional header mapping for gateway routing when tool schemas declare `x-mcp-header: true`.
- **Proxy buffering & keep-alive:** Streaming responses MUST set `X-Accel-Buffering: no` and emit periodic SSE `:` comment keep-alives to prevent Cloudflare/Nginx proxies from buffering or terminating `subscriptions/listen` streams.
```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp.js";

app.post("/mcp", async (c) => {
  const methodHeader = c.req.header("mcp-method");
  const t = new StreamableHTTPServerTransport();
  await server.connect(t);
  return t.handleRequest(c.req.raw, c.res);
});
app.get("/mcp", (c) => c.text("Method Not Allowed", 405));
```

## Mandatory Discovery: `server/discover`

Servers **MUST** implement `server/discover` per specification. It allows clients to fetch identity, supported protocol versions, and capabilities in a single round-trip without probing separate list endpoints.

```json
// Request (from client)
{
  "jsonrpc": "2.0",
  "id": "disc-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "ExampleClient", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}

// Response (from server)
{
  "jsonrpc": "2.0",
  "id": "disc-1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {},
      "extensions": {
        "io.modelcontextprotocol/tasks": {}
      }
    },
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "acme-service",
        "version": "1.0.0"
      }
    },
    "instructions": "Use list_items before mutate_item. Pass dry_run: true for preview.",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

## Message Patterns

Every transport carries all standardized JSON-RPC message patterns:
1. **Request & Response** — Standard client-request to server-result/error.
2. **Multi Round-Trip Requests (MRTR)** — When a tool needs confirmation or input before proceeding (e.g. destructive action), the server replies with `InputRequiredResult`:
   ```json
   { "resultType": "input_required", "inputRequests": [{ "id": "confirm", "message": "Delete project 'prod'?" }] }
   ```
   Client re-sends request with matching `inputResponses`.
3. **Subscribe & Notify** — Client sends `subscriptions/listen` to open a notification stream for list or resource updates.

## List & Resource Caching

On `resultType: "complete"`, servers **MUST** include caching hints for `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, and `resources/read`:
- `ttlMs`: Cache lifetime in milliseconds (e.g. `3600000` for 1 hour).
- `cacheScope`: `"public"` (shared across clients) or `"private"` (specific to authenticated caller).
## Deprecated features (2026-07-28 Spec)

| Feature | Status | Migration Path |
| --- | --- | --- |
| **HTTP+SSE transport** | Deprecated | Migrate to **Streamable HTTP** (POST `/mcp`) |
| **Roots (`client/roots`)** | Deprecated (SEP-2577) | Pass paths via tool parameters, resource URIs, or server config |
| **Sampling (`client/sampling`)** | Deprecated (SEP-2577) | Integrate directly with LLM provider APIs |
| **Logging (`notifications/message`)** | Deprecated (SEP-2577) | Use `stderr` for stdio; OpenTelemetry for remote HTTP observability |
| **DCR (RFC 7591)** | Deprecated | Use **Client ID Metadata Documents (CIMD)** for OAuth 2.1 |

## Dual-era compatibility matrix

| Client | Server | Behavior |
| --- | --- | --- |
| **Modern** (2026-07-28) | **Modern** | Works statelessly; per-request `_meta` + headers; `server/discover` fast-path |
| **Dual-era** | **Modern** | stdio sends `server/discover` probe → detects modern → proceeds statelessly |
| **Modern** | **Legacy** | Fails cleanly; stdio reports unhandled method; HTTP returns `400` / `404` |
| **Legacy** (`initialize`) | **Dual-era** | Server detects `initialize` → runs legacy session handshake |
| **Legacy** | **Modern** | Fails; modern server rejects `initialize` with unsupported protocol error |

Dual-era servers inspect the opening request: per-request `_meta` triggers modern stateless handling; `initialize` runs legacy session handling.

## Structured tool output

Return human `content` summary + machine `structuredContent` validated by JSON Schema:

```ts
server.tool(
  "list_projects",
  "List projects. Concise by default; format: detailed for full data.",
  {
    format: z.enum(["concise", "detailed"]).default("concise"),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async (args, ctx) => core.listProjects({ ...args, auth: ctx.auth }),
);
```

## Related

- `oauth-streamable-http.md` — OAuth 2.1 + PKCE + CIMD for Streamable HTTP
- `code-mode.md` — Sandboxed code orchestration over MCP tools
- `deployment-guide.md` — Cloudflare Workers & Docker deployment
