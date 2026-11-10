import { describe, expect, it } from 'vitest';
import { sepayHeaders } from '../../../../test/utils/payment-webhook-signing';
import {
  SEPAY_TIMESTAMP_TOLERANCE_S,
  verifySepayHmac,
} from './sepay-webhook-signature';

const secret = 'sepay-test-secret-0123456789';
const body = JSON.stringify({
  id: 92704,
  transferType: 'in',
  transferAmount: 125000,
  code: 'CHFABCDEFGH',
  content: 'CHFABCDEFGH chuyen tien',
});
const raw = Buffer.from(body, 'utf8');

describe('verifySepayHmac', () => {
  it('accepts a body signed as sha256=hex(HMAC(secret, "{ts}.{body}"))', () => {
    expect(verifySepayHmac(raw, sepayHeaders(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const headers = sepayHeaders(body, secret);
    const tampered = Buffer.from(body.replace('125000', '1250000'), 'utf8');
    expect(verifySepayHmac(tampered, headers, secret)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(
      verifySepayHmac(raw, sepayHeaders(body, 'another-secret'), secret),
    ).toBe(false);
  });

  it('rejects a timestamp outside ±300 s, and a signature moved to another timestamp', () => {
    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    for (const ts of [
      nowS - SEPAY_TIMESTAMP_TOLERANCE_S - 1,
      nowS + SEPAY_TIMESTAMP_TOLERANCE_S + 1,
    ]) {
      expect(
        verifySepayHmac(raw, sepayHeaders(body, secret, ts), secret, now),
      ).toBe(false);
    }
    const headers = sepayHeaders(body, secret, nowS);
    headers['x-sepay-timestamp'] = String(nowS - 1);
    expect(verifySepayHmac(raw, headers, secret, now)).toBe(false);
  });

  it('rejects missing headers and a bare hex signature without the sha256= prefix', () => {
    const good = sepayHeaders(body, secret);
    expect(
      verifySepayHmac(
        raw,
        { 'x-sepay-timestamp': good['x-sepay-timestamp'] },
        secret,
      ),
    ).toBe(false);
    expect(
      verifySepayHmac(
        raw,
        { 'x-sepay-signature': good['x-sepay-signature'] },
        secret,
      ),
    ).toBe(false);
    const bare = {
      ...good,
      'x-sepay-signature': good['x-sepay-signature']!.slice(7),
    };
    expect(verifySepayHmac(raw, bare, secret)).toBe(false);
  });
});
