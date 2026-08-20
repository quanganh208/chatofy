import { useEffect, useRef } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  DirectionToggle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ThemeToggle,
} from '@chatofy/ui/react';
import type { VoiceGender } from '@chatofy/types';
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

  const { settings, support, site, enablement, theme, microphoneNeeded, actions } = popup;

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

      <Group label="Speech">
        <div className="flex flex-col gap-2">
          <Label htmlFor="voice" className="text-prose font-normal">
            Voice
          </Label>
          <Select
            value={settings?.voiceGender ?? 'female'}
            disabled={!settings}
            onValueChange={(voiceGender) =>
              actions.change({ voiceGender: voiceGender as VoiceGender })
            }
          >
            <SelectTrigger id="voice" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="male">Male</SelectItem>
            </SelectContent>
          </Select>
        </div>

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

      <Group label="Appearance">
        <ThemeToggle value={theme} onChange={actions.setTheme} />
      </Group>
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
    <fieldset className="border-border flex min-w-0 flex-col gap-3 border-0 border-t pt-3">
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
