import type { OverlayState } from '../../src/messages';
import { runsOn, type SiteEnablement } from '../../src/site-enablement';
import { meetingSiteName, type MeetingSite } from '../../src/supported-meeting-url';

/**
 * What the footer says, as a function rather than a sequence of writes.
 *
 * Pulled out of the component because it is the popup's densest piece of
 * behaviour and none of it needs a DOM: four inputs, one sentence out. It was a
 * chain of early returns inside a render function that also touched six elements,
 * where the only way to check a case was to open the popup in that case.
 */

/** The first failure there is, named by which direction it belongs to. */
export function firstFailure(overlay: OverlayState | undefined): string | undefined {
  const errors = overlay?.errors;
  if (!errors) return undefined;
  if (errors.capture) return errors.capture;
  if (errors.inbound) return `Meeting audio: ${errors.inbound}`;
  if (errors.outbound) return `Your microphone: ${errors.outbound}`;
  return undefined;
}

export interface StatusInput {
  overlay: OverlayState | undefined;
  capturing: boolean;
  /** Whether the tab under this popup can be captured at all. Gates Start, only. */
  captureable: boolean;
  site: MeetingSite | undefined;
  enablement: SiteEnablement;
}

export function statusMessage({
  overlay,
  capturing,
  captureable,
  site,
  enablement,
}: StatusInput): string {
  const failure = firstFailure(overlay);
  if (failure) return failure;

  if (!capturing) {
    // A disabled control has to say why, next to itself. The notice at the top of
    // the popup carries the detail, but it is a scroll away from this button on a
    // tab with the platform list showing — and a button that is simply grey, with
    // its explanation off screen, reads as broken rather than as unavailable.
    // Being switched off is a different answer from being the wrong kind of tab,
    // and it is the one with a fix the reader can reach from this very popup.
    if (captureable) return 'Ready.';
    if (site && !runsOn(enablement, site)) return `Chatofy is off on ${meetingSiteName(site)}.`;
    return 'Not available on this tab.';
  }

  if (overlay?.outbound === 'monitor') {
    return 'Capturing this tab. Your speech is translated for you only.';
  }
  if (overlay?.outbound === 'sending') {
    return 'Capturing this tab, and translating your speech into the meeting.';
  }
  return 'Capturing this tab.';
}
