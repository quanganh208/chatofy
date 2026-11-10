import { describe, expect, it } from 'vitest';
import {
  newPolarSecret,
  polarHeaders,
} from '../../../../test/utils/payment-webhook-signing';
import {
  POLAR_TIMESTAMP_TOLERANCE_S,
  verifyStandardWebhook,
} from './polar-webhook-signature';

const body = JSON.stringify({
  type: 'order.paid',
  timestamp: '2026-11-09T10:00:00Z',
  data: { id: 'ord_1', billing_reason: 'purchase' },
});
const raw = Buffer.from(body, 'utf8');

describe('verifyStandardWebhook', () => {
  const secret = newPolarSecret();

  it('accepts a delivery signed with the Standard Webhooks key (base64 after whsec_)', () => {
    expect(verifyStandardWebhook(raw, polarHeaders(body, secret), secret)).toBe(
      true,
    );
  });

  it('accepts a delivery signed with the legacy key (UTF-8 of the whole secret)', () => {
    const headers = polarHeaders(body, secret, { scheme: 'legacy' });
    expect(verifyStandardWebhook(raw, headers, secret)).toBe(true);
  });

  it('accepts a user-provided secret that is not base64 at all', () => {
    const own = 'my-own-polar-secret!';
    const headers = polarHeaders(body, own, { scheme: 'legacy' });
    expect(verifyStandardWebhook(raw, headers, own)).toBe(true);
  });

  it('accepts when any entry of a space-separated signature list matches', () => {
    const headers = polarHeaders(body, secret);
    headers['webhook-signature'] = `v1,AAAA ${headers['webhook-signature']}`;
    expect(verifyStandardWebhook(raw, headers, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const headers = polarHeaders(body, secret);
    const tampered = Buffer.from(body.replace('ord_1', 'ord_2'), 'utf8');
    expect(verifyStandardWebhook(tampered, headers, secret)).toBe(false);
  });

  it('rejects a body re-serialised with different whitespace', () => {
    const headers = polarHeaders(body, secret);
    const pretty = Buffer.from(JSON.stringify(JSON.parse(body), null, 2));
    expect(verifyStandardWebhook(pretty, headers, secret)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const headers = polarHeaders(body, newPolarSecret());
    expect(verifyStandardWebhook(raw, headers, secret)).toBe(false);
  });

  it('rejects a stale or future timestamp', () => {
    const now = Date.now();
    const old = Math.floor(now / 1000) - POLAR_TIMESTAMP_TOLERANCE_S - 5;
    const future = Math.floor(now / 1000) + POLAR_TIMESTAMP_TOLERANCE_S + 5;
    for (const timestamp of [old, future]) {
      const headers = polarHeaders(body, secret, { timestamp });
      expect(verifyStandardWebhook(raw, headers, secret, now)).toBe(false);
    }
  });

  it('rejects a changed webhook-id (it is part of the signed content)', () => {
    const headers = polarHeaders(body, secret);
    headers['webhook-id'] = 'msg_other';
    expect(verifyStandardWebhook(raw, headers, secret)).toBe(false);
  });

  it('rejects missing headers, a non-v1 version and a malformed timestamp', () => {
    const good = polarHeaders(body, secret);
    for (const name of [
      'webhook-id',
      'webhook-timestamp',
      'webhook-signature',
    ]) {
      const headers: Record<string, string> = { ...good };
      delete headers[name];
      expect(verifyStandardWebhook(raw, headers, secret)).toBe(false);
    }
    const v2 = {
      ...good,
      'webhook-signature': good['webhook-signature']!.replace('v1,', 'v2,'),
    };
    expect(verifyStandardWebhook(raw, v2, secret)).toBe(false);
    expect(
      verifyStandardWebhook(
        raw,
        { ...good, 'webhook-timestamp': '12abc' },
        secret,
      ),
    ).toBe(false);
  });
});
