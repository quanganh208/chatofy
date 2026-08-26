'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@chatofy/ui/react';
import { checkHealth } from '@/clients/api-client';
import { useMicrophoneAvailability } from '@/hooks/use-microphone-availability';
import { useMicrophonePermission } from '@/hooks/use-microphone-permission';
import { useTranslate } from '@/i18n/provider';
import { ReadinessRow, type ReadinessTone } from './readiness-row';
import { CardEyebrow } from './card-eyebrow';
import type { MicrophoneAvailability } from '@/hooks/use-microphone-availability';
import type { MicrophonePermission } from '@/hooks/use-microphone-permission';
import type { MessageKey } from '@chatofy/i18n';

/**
 * The two things that decide whether a conversation can start, and one piece of advice.
 *
 * Everything here is either measured now or permanently true. Nothing is counted and
 * nothing is remembered — this page has no history to show because the schema has no
 * table to show it from, and inventing one would contradict the product's own claim
 * that nothing is kept.
 *
 * The headphones row is the odd one and it is deliberate: it is not a measurement and
 * does not pretend to be. Its tone is `unknown` because that is exactly what it is —
 * advice about a device this page cannot see. Playing the translation through speakers
 * feeds it back into the microphone, so the row earns its place; claiming to have
 * detected headphones would not.
 */

const MIC: Record<MicrophonePermission | 'absent', { tone: ReadinessTone; key: MessageKey }> = {
  granted: { tone: 'ok', key: 'web.dashboard.micGranted' },
  denied: { tone: 'problem', key: 'web.dashboard.micDenied' },
  prompt: { tone: 'unknown', key: 'web.dashboard.micPrompt' },
  unknown: { tone: 'unknown', key: 'web.dashboard.micUnknown' },
  // Permission granted and no device is the pairing this row used to report as `ok`.
  absent: { tone: 'problem', key: 'web.dashboard.micAbsent' },
};

/**
 * Which of the two microphone facts to show.
 *
 * `denied` wins over `absent` because it is the more certain of the two and the more
 * actionable: a blocked permission is stated outright by the Permissions API, while a
 * blocked browser may also be the reason the device list came back empty. Reporting
 * "no microphone" to someone who merely has to click Allow would send them looking for
 * a cable.
 */
function micState(
  permission: MicrophonePermission,
  availability: MicrophoneAvailability,
): MicrophonePermission | 'absent' {
  if (permission === 'denied') return 'denied';
  return availability === 'absent' ? 'absent' : permission;
}

type ServiceState = 'checking' | 'reachable' | 'unreachable';

const SERVICE: Record<ServiceState, { tone: ReadinessTone; key: MessageKey }> = {
  checking: { tone: 'unknown', key: 'web.dashboard.serviceChecking' },
  reachable: { tone: 'ok', key: 'web.dashboard.serviceReachable' },
  unreachable: { tone: 'problem', key: 'web.dashboard.serviceUnreachable' },
};

export function ReadinessCard() {
  const t = useTranslate();
  const microphone = useMicrophonePermission();
  const microphoneAvailability = useMicrophoneAvailability();
  const [service, setService] = useState<ServiceState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // Only in the callbacks: a synchronous write here would re-render to set the
    // value the state already holds. The abort is what stops a slow probe from
    // reporting into an unmounted page.
    checkHealth(controller.signal)
      .then(() => {
        if (!cancelled) setService('reachable');
      })
      .catch(() => {
        if (!cancelled) setService('unreachable');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const mic = MIC[micState(microphone, microphoneAvailability)];
  const svc = SERVICE[service];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <CardEyebrow>{t('web.dashboard.readiness')}</CardEyebrow>
        <div className="flex flex-col gap-3">
          <ReadinessRow label={t('web.dashboard.microphone')} tone={mic.tone} value={t(mic.key)} />
          <ReadinessRow label={t('web.dashboard.service')} tone={svc.tone} value={t(svc.key)} />
          <ReadinessRow
            label={t('web.dashboard.headphones')}
            tone="unknown"
            value={t('web.dashboard.headphonesRecommended')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
