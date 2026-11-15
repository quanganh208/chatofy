import { createOneShot, HAND_OFF_TTL_MS } from '@/lib/one-shot';

/**
 * A one-shot flag that a team was just created here, so the team view that mounts
 * next puts the caret in its invite email: inviting is the next thing to do.
 *
 * Module state because the create form unmounts as the workspace switches, and the
 * invite form is in the view that replaces it. Read once, from the invite form's
 * `useState` initializer, and it expires, so a team view mounted much later — after
 * the switch failed — does not steal focus.
 */
const focus = createOneShot(HAND_OFF_TTL_MS);

export const requestInviteFocus = (): void => focus.request();

/** True once after a recent request; reading it clears it. */
export const consumeInviteFocus = (): boolean => focus.consume();
