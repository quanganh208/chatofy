import { createOneShot, HAND_OFF_TTL_MS } from '@/lib/one-shot';

/**
 * "Open Settings › Team on its create form" — a one-shot request from the workspace
 * switcher's "Create team" item to the Team pane. The requester calls
 * `requestTeamCreateForm()` just before `openSettingsDialog('team')`; the pane reads
 * `consumeTeamCreateIntent()` once, from a `useState` initializer.
 *
 * Module state and not the URL: `?settings=team` is the dialog's whole address, shared
 * by Back, reloads and links, and an expanded form is not a place to land on again.
 */
const intent = createOneShot(HAND_OFF_TTL_MS);

/** Ask the next Team pane to mount with its create form open. */
export const requestTeamCreateForm = (): void => intent.request();

/** Whether a create form was requested; reading it clears the request. */
export const consumeTeamCreateIntent = (): boolean => intent.consume();
