import { useEffect, useRef } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  DirectionToggle,
  Label,
  SegmentedControl,
  type SegmentedOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ThemeToggle,
} from '@chatofy/ui/react';
import type { VoiceGender } from '@chatofy/types';

/**
 * Stands for "no context" in the picker's own value space.
 *
 * Radix `Select` reserves an empty string to mean "nothing selected" internally,
 * so a real option cannot use it — and `contextId` clearing to `undefined` has
 * to round-trip through SOME string while the control is open. A context's id
 * is a `z.uuid()` (`translationContextSchema`), so this can never collide with
 * a real one.
 */
const NO_CONTEXT_VALUE = 'none';

/** Two named things, so both are shown rather than hidden behind a trigger. */
const VOICE_OPTIONS: ReadonlyArray<SegmentedOption<VoiceGender>> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];
import { runsOn } from '../../src/site-enablement';
import { SUPPORTED_MEETINGS } from '../../src/supported-meeting-url';
import type { usePopup } from './use-popup';

/**
 * The scrolling half of the popup: everything that is a choice rather than an action.
 *
 * Settings are not tied to a tab and are never hidden for being on the wrong one.
 * Hiding them made them unreachable during a call that runs in its own toolbar-less
 * window, which is the only place the popup cannot be opened from.
 */

type Popup = ReturnType<typeof usePopup>;

export function SettingsPane({ popup, hidden }: { popup: Popup; hidden: boolean }) {
  const pane = useRef<HTMLElement>(null);

  /**
   * Mark the pane as scrolling, when it is.
   *
   * Measured rather than assumed, because whether it overflows depends on what the
   * tab is: the platform list adds height on a tab that is not a meeting, and the
   * microphone notice adds more. Re-measured after every render — a fade that
   * outlives its reason is the artefact it was added to remove, and the render that
   * removes the reason is the one that has to clear it.
   */
  useEffect(() => {
    const node = pane.current;
    if (!node) return;
    const scrolls = node.scrollHeight > node.clientHeight;
    node.dataset.scrolls = String(scrolls);
  });

  const { settings, contexts, support, site, enablement, theme, microphoneNeeded, actions } = popup;

  return (
    <main
      ref={pane}
      id="settings"
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4"
    >
      {/* Why this tab cannot be captured, when it cannot. One line: naming the three
          platforms here as well as in the switches below meant the popup said the
          same thing twice and pushed the switches off screen, which is the opposite
          of useful to the reader who is on the wrong tab. */}
      {support.ok ? null : (
        <Alert variant={support.kind === 'action' ? 'warning' : 'default'}>
          <AlertDescription>{support.message}</AlertDescription>
        </Alert>
      )}

      <DirectionToggle
        value={settings?.direction ?? 'en_to_vi'}
        disabled={!settings}
        onChange={(direction) => actions.change({ direction })}
      />

      {/* Hidden entirely rather than shown empty or disabled: this control offers
          nothing while there is nothing to choose, and the popup is signed out
          exactly when `contexts` is empty (`use-popup.ts` fetches nothing without
          a session). No editor here — the popup is the wrong size for authoring
          24 term pairs, and authoring happens on web; this only selects. */}
      {contexts.length > 0 ? (
        <Group label="AI Context">
          <Select
            value={settings?.contextId ?? NO_CONTEXT_VALUE}
            disabled={!settings}
            onValueChange={(value) =>
              actions.setContext(value === NO_CONTEXT_VALUE ? undefined : value)
            }
          >
            <SelectTrigger id="context" className="w-full">
              <SelectValue placeholder="No context" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CONTEXT_VALUE}>No context</SelectItem>
              {contexts.map((context) => (
                <SelectItem key={context.id} value={context.id}>
                  {context.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Group>
      ) : null}

      <Group label="Speech">
        {/* The same control the web page uses, which it did not used to be.
            This was a `Select`, on the reasoning that 320px could not spare the
            row two segments would cost. Two things were wrong with that. The row
            is the same height either way — the label sits above the control in
            both — and a dropdown inside an extension popup is a portal inside a
            320x600 window, where `--radix-select-content-available-height` leaves
            it almost nothing to open into: it flashed and closed. A choice
            between two named things does not need a menu. */}
        <SegmentedControl
          label="Voice"
          value={settings?.voiceGender ?? 'female'}
          disabled={!settings}
          options={VOICE_OPTIONS}
          onChange={(voiceGender) => actions.change({ voiceGender })}
        />

        {/* A separate choice from translating the meeting: this one opens the
            microphone and translates the user's own speech. */}
        <Row>
          <Checkbox
            id="outbound"
            checked={settings?.outbound ?? false}
            disabled={!settings}
            onCheckedChange={(checked) => actions.change({ outbound: checked === true })}
          />
          <Label htmlFor="outbound" className="text-prose font-normal">
            Also translate what I say
          </Label>
        </Row>

        {microphoneNeeded ? (
          <Alert variant="warning">
            <AlertDescription className="flex flex-col items-start gap-2">
              Chrome has not given Chatofy your microphone yet. Without it, nothing you say is
              translated.
              <Button id="mic-allow" size="sm" variant="outline" onClick={actions.allowMicrophone}>
                Allow microphone
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </Group>

      {/* Above "Runs on", and that order is the point.

          Appearance is changed on a whim and changed often; where the extension
          may run is set once and then left alone. Below the platform list this
          control sat past the fold on every tab — the pane is taller than the
          popup whenever three site rows are showing, which is always. Putting the
          rarely-touched list last costs it nothing: it is still reachable, which
          was the whole requirement on it. */}
      <Group label="Appearance">
        {/* `w-fit`, because the group is a flex column and a stretched item
            draws the pill's border across the full 288px around three small
            icons. */}
        <ThemeToggle value={theme} onChange={actions.setTheme} className="w-fit" />
      </Group>

      {/* Where Chatofy is allowed to act. Deliberately reachable: someone who does
          not want this on a particular call needs to find it without knowing it
          exists.

          All three platforms are always listed, whatever tab this popup was opened
          over. They were once a single row for the current tab, which meant the list
          could never be seen and Meet could only be switched off while sitting on a
          Meet tab — this is configuration, not a per-tab action. The rows are built
          from `SUPPORTED_MEETINGS` so they cannot drift from the patterns the
          extension actually matches. */}
      <Group label="Runs on">
        <Row>
          <Checkbox
            id="run-enabled"
            checked={enablement.enabled}
            onCheckedChange={(checked) => actions.setRunEnabled(checked === true)}
          />
          <Label htmlFor="run-enabled" className="text-prose font-normal">
            Enable Chatofy on meeting pages
          </Label>
        </Row>

        {SUPPORTED_MEETINGS.map((meeting) => (
          <Row key={meeting.site}>
            <Checkbox
              id={`run-${meeting.site}`}
              checked={runsOn(enablement, meeting.site)}
              // Nothing to say about one platform while Chatofy is off everywhere.
              disabled={!enablement.enabled}
              onCheckedChange={(checked) => actions.setSiteEnabled(meeting.site, checked === true)}
            />
            <div className="flex min-w-0 flex-col">
              {/* The label reads as "on", not "off", so it points the same way as
                  the master switch above it. A pair where one is an opt-in and the
                  other an opt-out is a pair someone will read backwards. */}
              <Label htmlFor={`run-${meeting.site}`} className="text-prose font-normal">
                {meeting.name}
                {/* Says which of the three the popup is standing over, so the row
                    that matters right now does not have to be worked out from the
                    header. */}
                {meeting.site === site ? (
                  <span className="text-muted-foreground text-label">this tab</span>
                ) : null}
              </Label>
              {/* The qualification a prose list buried — Zoom means the web client,
                  Facebook includes Messenger. It rides on the switch now, which is
                  the only place these three are named, so it is also the answer to
                  "which Zoom?". */}
              <span className="text-muted-foreground text-hint">{meeting.detail}</span>
            </div>
          </Row>
        ))}
      </Group>
      {/* Last, and quiet: signing out stops a running capture, so it belongs
          below the things someone came here to change rather than beside them. */}
      <div className="border-hairline flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-muted-foreground text-hint">Signed in</p>
        <Button id="sign-out" variant="ghost" size="sm" onClick={actions.signOut}>
          Sign out
        </Button>
      </div>
    </main>
  );
}

/**
 * A group of settings that depend on the one above them, not a box.
 *
 * The border is a single rule between regions: a 320px page divided into outlined
 * cards reads as four things to deal with rather than one to skim past.
 *
 * `min-w-0` is not decorative. A fieldset carries `min-inline-size: min-content` in
 * the UA sheet, which no other block does; "Runs on" holds three nowrap platform
 * details, and the group measured wider than the column it sits in. A pane that
 * scrolls vertically computes `overflow-x` to `auto` as well, so that surplus
 * arrived as a horizontal scrollbar under content with nowhere to go.
 */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-hairline flex min-w-0 flex-col gap-3 border-0 border-t pt-3">
      <legend className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2">{children}</div>;
}
