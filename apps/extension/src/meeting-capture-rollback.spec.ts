import { describe, expect, it, vi } from 'vitest';
import { harness } from './fake-meeting-audio';
import { MeetingCapture } from './meeting-capture';
import type { CaptureSettings } from './messages';

/**
 * What the extension does once the streaming feature is turned back off.
 *
 * `direction-session.ts` promises that setting `CASCADE_STREAMING` to `false` is
 * the rollback for the whole feature. The microphone gate is now part of that
 * promise — the old backend coming back with the echo exemption still in place
 * would leave the self-translation loop open in the one mode that has gaps for
 * it to matter in.
 *
 * A file of its own because the promise is about a compile-time constant, and
 * `vi.mock` is per-file. Testing it in `meeting-capture.spec.ts` by asserting
 * the gate was handed `CASCADE_STREAMING` proves nothing while that constant is
 * `true`: the assertion and the bug agree. Only actually flipping it does.
 */

vi.mock('./direction-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./direction-session')>()),
  CASCADE_STREAMING: false,
}));

const settings = (overrides: Partial<CaptureSettings> = {}): CaptureSettings => ({
  direction: 'en_to_vi',
  mode: 'cascade',
  voiceGender: 'female',
  apiBaseUrl: 'http://localhost:3000',
  reportMetrics: false,
  outbound: false,
  ...overrides,
});

describe('a cascade with streaming rolled back', () => {
  it('shuts the microphone again while a translation is audible', async () => {
    const h = harness();
    await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));
    const microphone = h.microphones[0]!;

    h.sessions.inbound!.deps.onSounding(true);
    expect(microphone.suppressed).toBe(true);

    h.sessions.inbound!.deps.onSounding(false);
    expect(microphone.suppressed).toBe(false);
  });

  it('still counts the outbound direction while it only monitors', async () => {
    // The pre-branch expression in full: `sounding.inbound || (sounding.outbound
    // && !sending)`. Rolling streaming back has to restore all of it, not the
    // inbound half.
    const h = harness();
    await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));

    h.sessions.outbound!.deps.onSounding(true);

    expect(h.microphones[0]!.suppressed).toBe(true);
  });

  it('leaves live mode exempt, which never depended on the constant', async () => {
    const h = harness();
    await new MeetingCapture(h.deps).begin('stream-1', settings({ mode: 'live', outbound: true }));

    h.sessions.inbound!.deps.onSounding(true);

    expect(h.microphones[0]!.suppressed).toBe(false);
  });
});
