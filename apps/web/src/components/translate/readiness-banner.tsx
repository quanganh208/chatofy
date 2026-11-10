'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@chatofy/ui/react';
import type { CreditBalance } from '@chatofy/types';
import { checkHealth } from '@/clients/api-client';
import { useCreditBalance } from '@/hooks/use-credits';
import { useMicrophoneAvailability } from '@/hooks/use-microphone-availability';
import { useMicrophonePermission } from '@/hooks/use-microphone-permission';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits } from '@/lib/credit-format';
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
 * refused, or there is no device. The balance follows the same rule: under one
 * credit and at two or fewer are both definite, an unread balance is not.
 *
 * ## "No device" is only definite once permission was granted
 *
 * An empty `audioinput` list is not by itself evidence that no microphone
 * exists. Browsers are supposed to publish a blank placeholder entry per kind
 * before permission is decided, and where one does not, the list is simply empty
 * until someone clicks Allow. Trusting it there put "No microphone found" on the
 * screen of every first-time visitor who had a microphone plugged in — the exact
 * false alarm the `prompt` rule above exists to prevent, arriving through the
 * other input.
 *
 * So `absent` counts only under `granted`, where the browser had every reason to
 * enumerate fully and an empty list means what it says. Under `prompt` or
 * `unknown` it is the absence of an answer, and pressing Start is what turns it
 * into one: `open-microphone.ts` maps `NotFoundError` onto the same sentence.
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
  if (availability === 'absent' && permission === 'granted') return 'web.translate.micNotFound';
  return null;
}

/** At or under this many credits, a conversation started now will stop soon. */
const LOW_CREDITS = 2;

/**
 * The balance, when it is a definite problem: under one credit (the server will
 * refuse Start) or at two or fewer (a conversation will stop soon).
 *
 * Read once per mount, which is once per visit and once after every
 * conversation — the banner unmounts while one runs. A balance that could not be
 * read says nothing: Start is never disabled here, the server decides, and its
 * refusal is reported by the conversation itself.
 */
function creditsFault(
  balance: CreditBalance | null,
): { key: 'common.billing.startRefused' } | { key: 'common.billing.low'; credits: number } | null {
  if (!balance) return null;
  if (balance.totalCredits < 1) return { key: 'common.billing.startRefused' };
  if (balance.totalCredits <= LOW_CREDITS)
    return { key: 'common.billing.low', credits: balance.totalCredits };
  return null;
}

export function ReadinessBanner() {
  const t = useTranslate();
  const locale = useLocale();
  const permission = useMicrophonePermission();
  const availability = useMicrophoneAvailability();
  const { balance } = useCreditBalance();
  const [serviceDown, setServiceDown] = useState(false);
  // Which probe is the current answer. Nothing else orders them: a probe against a
  // hung API settles at its 5s timeout, so one started a second later can resolve
  // four seconds before it — and the banner would then be written by whichever
  // request the network happened to finish last rather than by the latest question
  // asked. That is a stale "service unreachable" over a service that is up.
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;

    // Set only in the callbacks: "checking" is not a state worth a line of prose
    // here, because a probe still in flight is not a problem to report.
    // `AbortSignal.any`, not the bare controller: `checkHealth` falls back to its
    // own 5s timeout only when handed nothing (`api-client.ts:292`), so passing a
    // controller alone removes the timeout. A hung API would then never settle and
    // this banner would stay silent — indistinguishable, on screen, from healthy.
    const probe = () => {
      const id = (seq.current += 1);
      // The probe this supersedes is abandoned rather than left running. Its answer
      // is going to be ignored either way, so a request still in the air for it is
      // the redundant concurrent probe that rapid tab switching used to spend one
      // of per toggle. At most one is ever live.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      checkHealth(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])).then(
        () => {
          if (!cancelled && id === seq.current) setServiceDown(false);
        },
        () => {
          if (!cancelled && id === seq.current) setServiceDown(true);
        },
      );
    };

    probe();

    // One probe per mount would latch: a reader who starts the API after seeing
    // this is told it is still down until they reload the page, which is the one
    // instruction the banner must not give. Re-probing when the tab comes back to
    // the front is what a person restarting a service actually does next, and it
    // costs nothing while they are elsewhere — a poll would spend a request a
    // minute on a screen whose answer changes about once a day.
    const recheck = () => {
      if (document.visibilityState === 'visible') probe();
    };
    document.addEventListener('visibilitychange', recheck);

    return () => {
      cancelled = true;
      inFlight?.abort();
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  const micKey = microphoneFault(permission, availability);
  const credits = creditsFault(balance);
  if (!micKey && !serviceDown && !credits) return null;

  return (
    <Alert variant="warning">
      <AlertDescription className="flex flex-col gap-1">
        {micKey ? <span>{t(micKey)}</span> : null}
        {serviceDown ? <span>{t('web.translate.serviceUnreachable')}</span> : null}
        {credits ? (
          <span data-credits-fault>
            {credits.key === 'common.billing.low'
              ? t(credits.key, { credits: formatCredits(t, locale, credits.credits) })
              : t(credits.key)}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
