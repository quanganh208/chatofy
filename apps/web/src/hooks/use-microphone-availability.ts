'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this machine has a microphone at all — a different question from permission,
 * and the one that was missing.
 *
 * A granted permission says the browser WOULD hand over a microphone; it does not say
 * one exists. With every input jack empty, `navigator.permissions` still answers
 * `granted` from a decision made when a headset was plugged in, the readiness card
 * still says so, and the first sign of trouble is `getUserMedia` rejecting with
 * `NotFoundError` at the moment someone presses Start. That is the wrong moment to
 * find out, which is why this is measured separately and shown beside the permission.
 *
 * An empty `audioinput` list is read as "no microphone", not as "cannot tell":
 * browsers publish one placeholder entry per kind before permission is granted —
 * blank `label`, blank `deviceId` — precisely so a page can know a device exists
 * without being told which. No entry means no device.
 *
 * The `devicechange` subscription is not optional. Plugging a microphone in is the fix
 * this row is asking for, and a one-shot read would leave the card claiming there is
 * none for as long as the tab stays open.
 */
export type MicrophoneAvailability = 'present' | 'absent' | 'unknown';

export function useMicrophoneAvailability(): MicrophoneAvailability {
  const [availability, setAvailability] = useState<MicrophoneAvailability>('unknown');

  useEffect(() => {
    // `mediaDevices` is absent outside a secure context, and `enumerateDevices` is
    // absent in older browsers. Both leave the state at `unknown`, which is true.
    const devices = navigator.mediaDevices;
    if (!devices?.enumerateDevices) return;

    let cancelled = false;
    const read = () => {
      devices
        .enumerateDevices()
        .then((list) => {
          if (cancelled) return;
          setAvailability(list.some((d) => d.kind === 'audioinput') ? 'present' : 'absent');
        })
        .catch(() => {
          // A browser that refuses to enumerate has told us nothing. `unknown` is
          // already the state on first read, and overwriting a real earlier answer
          // with it would be a downgrade, so nothing is written here either.
        });
    };

    read();
    devices.addEventListener('devicechange', read);
    return () => {
      cancelled = true;
      devices.removeEventListener('devicechange', read);
    };
  }, []);

  return availability;
}
