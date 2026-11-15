/**
 * A one-shot request, from outside Settings, to open Settings › Team on its create
 * form: something calls `requestTeamCreateForm()` and then opens the tab, and the
 * tab takes the request once when it mounts. Module state, not React state, because
 * the caller and the tab are in different trees.
 */
let requested = false;

export function requestTeamCreateForm(): void {
  requested = true;
}

/** True once after a request; reading it clears it. */
export function consumeTeamCreateIntent(): boolean {
  const was = requested;
  requested = false;
  return was;
}
