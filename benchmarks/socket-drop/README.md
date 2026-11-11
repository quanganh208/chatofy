# socket-drop harness

Checks that a /translate conversation survives its socket dying mid-sentence.

This is measurement only. It is **not** part of the pnpm/turbo workspace and is never imported by the app, the same convention as `benchmarks/call-budget`.

## The shape it reproduces

On 2026-11-11, prod conversation `09ddb1a2` ended with "Connection to the translator dropped". The browser's socket died between the browser and the Cloudflare edge. The API's end stayed open, so the server never saw the close: it translated and voiced the last turn into a dead socket, and that turn was missing from history.

`replay-with-forced-drop.mts` runs a TCP proxy on `127.0.0.1:4100` in front of the API. At `--drop-at-ms` it destroys the client leg of the live connection but keeps the upstream leg open and drained. That is a half-open socket on the API side, exactly as on that day.

## Running it

```bash
cd apps/api && npx tsx ../../benchmarks/socket-drop/replay-with-forced-drop.mts \
  --api 127.0.0.1:4000 --token-file "$SCRATCHPAD/owner-token" --id <recording> \
  --one-way en:vi --drop-at-ms 60000
```

Run the same recording with `--drop-at-ms 0` for the baseline. Add `--no-reconnect` to leave the client's reconnect off and watch the server heartbeat free the half-open socket on its own: `session.disconnect` should appear in the API log within 30 s of the drop.

The token comes from a 0600 file; see the memory note on verifying a rollout by replay. The harness drives the shipped `ConversationSession` with `reconnectOnDrop` on, as the web page does, and voice off.

## What it prints

Counts only, never text:

- `turns=`: rows the page's transcript reducer holds, which is what history saves;
- `reconnects=`;
- `resubmitted=`;
- `connections=` through the proxy;
- whether the status passed through `reconnecting`;
- the final status;
- `server.error` codes.

Read the API log between the `window-start` and `window-end` lines for `socket.superseded`, `connection.report`, `resubmitted after a dropped connection`, `too_many_turns` and `idle for`.

The proxy talks to `127.0.0.1:4000` directly and never passes through Cloudflare. It proves the client and the server, not whether the edge answers WebSocket pings itself.
