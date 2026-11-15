/**
 * A one-shot flag that a team was just created here, so the team view that mounts
 * next puts the caret in its invite email: inviting is the next thing to do.
 *
 * Module state because the create form unmounts as the workspace switches, and the
 * invite form is in the view that replaces it. Consumed on the invite form's first
 * render, so a later visit to the tab does not steal focus.
 */
let pending = false;

export function requestInviteFocus(): void {
  pending = true;
}

/** True once after a request; reading it clears it. */
export function consumeInviteFocus(): boolean {
  const was = pending;
  pending = false;
  return was;
}
