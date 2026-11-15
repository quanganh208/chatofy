/**
 * "Open Settings › Team with the create form already expanded" — a one-shot request
 * from the workspace switcher's "Create team" item to the Team pane.
 *
 * ## Contract
 *
 * - The REQUESTER calls `requestTeamCreateForm()` immediately before
 *   `openSettingsDialog('team')`.
 * - The Team pane calls `consumeTeamCreateIntent()` ONCE when it mounts (a `useState`
 *   initializer or a mount effect) and expands its create form when it returns `true`.
 *
 * Why module state and not the URL: `?settings=team` is the dialog's whole address
 * and is shared by Back, reloads and links; an expanded form is not a place anyone
 * should land on again by going back or reloading. The request is a single moment.
 *
 * Reads are idempotent within the tick they start in, and the request clears on the
 * next macrotask. That is what makes it safe under React StrictMode, which calls a
 * state initializer twice and mounts, unmounts and remounts effects synchronously:
 * every one of those reads answers `true`, and nothing after them does.
 *
 * A request that nobody consumes expires after {@link INTENT_TTL_MS}, so a pane
 * mounted much later — the reader opening Settings by hand a minute after the dialog
 * failed to open — never springs the form on them.
 */
export const INTENT_TTL_MS = 5_000;

let requestedAt: number | undefined;
let clearScheduled = false;

/** Ask the next Team pane to mount with its create form open. */
export function requestTeamCreateForm(): void {
  requestedAt = Date.now();
  clearScheduled = false;
}

/** Whether a create form was requested; clears the request after this tick. */
export function consumeTeamCreateIntent(): boolean {
  if (requestedAt === undefined) return false;
  if (Date.now() - requestedAt > INTENT_TTL_MS) {
    requestedAt = undefined;
    return false;
  }
  if (!clearScheduled) {
    clearScheduled = true;
    setTimeout(() => {
      // A fresh request made inside the same tick reset the flag; keep that one.
      if (!clearScheduled) return;
      requestedAt = undefined;
      clearScheduled = false;
    }, 0);
  }
  return true;
}
