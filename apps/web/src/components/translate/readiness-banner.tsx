'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@chatofy/ui/react';
import { checkHealth } from '@/clients/api-client';
import { useMicrophoneAvailability } from '@/hooks/use-microphone-availability';
import { useMicrophonePermission } from '@/hooks/use-microphone-permission';
import { useTranslate } from '@/i18n/provider';
import type { MicrophoneAvailability } from '@/hooks/use-microphone-availability';
import type { MicrophonePermission } from '@/hooks/use-microphone-permission';
import type { MessageKey } from '@chatofy/i18n';

/**
 * What would stop a conversation starting, said before you try to start one.
 *
 * This is what survives of the hub's readiness card, and it survives because the
 * reactive path does not cover it. `lib/open-microphone.ts` already maps every
 * `getUserMedia` fault onto a sentence, so a blocked microphone IS reported —
 * when you press Start. The card's contribution was saying so first.
 *
 * ## It reports problems and nothing else
 *
 * The card listed three rows whatever they said, so two thirds of it was usually
 * a green tick confirming that a thing you never doubted still works. That is the
 * card grammar this redesign is removing: a panel of readouts standing in for a
 * page. Here, silence means ready.
 *
 * ## `unknown` is not a problem
 *
 * The row component this replaces had three tones because the answers reduce to
 * three, and its docblock is emphatic that `unknown` must never render as `ok` —
 * the Permissions API does not answer in every browser. The same care points the
 * other way now: `prompt` and `unknown` are not problems either, so they say
 * nothing. Warning a reader about a permission the browser simply has not been
 * asked for yet would make this fire on a first visit in Safari, every time, for
 * nothing. If it turns out to be a real fault, pressing Start reports it.
 *
 * So this speaks only for the two answers that are definite: the permission was
 * refused, or there is no device.
 */

/** The two microphone answers that are certainly wrong, and nothing else. */
function microphoneFault(
  permission: MicrophonePermission,
  availability: MicrophoneAvailability,
): MessageKey | null {
  // `denied` wins over `absent`: it is the more certain of the two and the more
  // actionable. A blocked browser may also be why the device list came back
  // empty, and telling someone who has to click Allow that they have no
  // microphone sends them looking for a cable.
  if (permission === 'denied') return 'web.translate.micDenied';
  if (availability === 'absent') return 'web.translate.micNotFound';
  return null;
}

export function ReadinessBanner() {
  const t = useTranslate();
  const permission = useMicrophonePermission();
  const availability = useMicrophoneAvailability();
  const [serviceDown, setServiceDown] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // Only in the callbacks, and only ever set to `true`: "checking" is not a
    // state worth a line of prose here, because a probe still in flight is not a
    // problem to report.
    checkHealth(controller.signal).catch(() => {
      if (!cancelled) setServiceDown(true);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const micKey = microphoneFault(permission, availability);
  if (!micKey && !serviceDown) return null;

  return (
    <Alert variant="warning">
      <AlertDescription className="flex flex-col gap-1">
        {micKey ? <span>{t(micKey)}</span> : null}
        {serviceDown ? <span>{t('web.translate.serviceUnreachable')}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
