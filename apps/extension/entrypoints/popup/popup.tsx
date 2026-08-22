import { Button, StatusIndicator } from '@chatofy/ui/react';
import { SettingsPane } from './settings-pane';
import { SignInPane } from './sign-in-pane';
import { usePopup } from './use-popup';

/**
 * The popup: pick a direction and a voice, start, stop.
 *
 * The recording notice is not in this tree — see `consent-gate.ts`. While it is
 * unacknowledged everything here is hidden AND Start is disabled. Hidden alone
 * would be enough to stop a click, but it says nothing about the button's state,
 * and the harness that photographs this page reads the state.
 */
export function Popup() {
  const popup = usePopup();
  // `undefined` means storage has not answered yet, which is not the same as "no
  // notice needed" — the settings must not appear during that window.
  const consenting = popup.consentRequired !== false;
  // Same reasoning for the token: `undefined` is "storage has not answered", and
  // flashing a sign-in form at someone who is signed in is worse than a blank
  // instant. Consent comes first — the notice is about recording at all, which
  // is a larger question than whose account does the translating.
  const authenticating = !consenting && popup.signedIn === false;
  const ready = !consenting && popup.signedIn === true;

  return (
    <>
      <header
        id="chrome"
        hidden={consenting}
        className="border-hairline flex flex-none items-center gap-2 border-b px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <strong className="text-body font-semibold tracking-tight">Chatofy</strong>
          {/* The tab this popup is about, truncated rather than wrapped: a long
              meeting URL is not worth a second line in a header. */}
          <p className="text-muted-foreground text-hint truncate">{popup.host}</p>
        </div>
        <StatusIndicator
          tone={popup.capturing ? 'live' : 'idle'}
          label={popup.capturing ? 'Recording' : 'Idle'}
          className="border-hairline bg-secondary text-hint flex-none rounded-full border px-2.5 py-1"
        />
      </header>

      <SignInPane popup={popup} hidden={!authenticating} />

      <SettingsPane popup={popup} hidden={!ready} />

      {/* Starting, unlike the settings, is about this tab. Outside the scrolling
          region so that it is on screen whatever the form above it is doing. */}
      <footer
        id="capture"
        hidden={!ready}
        className="border-hairline flex flex-none flex-col gap-2 border-t px-4 py-3"
      >
        <Button
          id="toggle"
          variant={popup.capturing ? 'live' : 'default'}
          className="w-full"
          // Stop is always available; Start is not. A capture that a reload or a tab
          // switch left running must stay stoppable from here even when this tab is
          // no longer one Chrome would let us start on. Consent gates both: nothing
          // may be started or stopped before the notice has been read.
          disabled={!ready || (!popup.capturing && !popup.captureable)}
          onClick={popup.actions.toggleCapture}
        >
          {popup.capturing ? 'Stop' : 'Start'}
        </Button>
        <p id="status" className="text-muted-foreground text-hint">
          {popup.status}
        </p>
      </footer>
    </>
  );
}
