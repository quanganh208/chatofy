import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { validateEnv, type Env } from '../../../config/env.schema';
import {
  costPolicyFromEnv,
  DEFAULT_COST_POLICY,
} from './translation-cost-policy';

/** A ConfigService over exactly what the schema makes of `values`. */
const configFrom = (values: Record<string, string>) => {
  const env = validateEnv({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    AUTH_JWT_SECRET: 'x'.repeat(32),
    ...values,
  });
  return {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
};

describe('costPolicyFromEnv', () => {
  it('is the default policy when nothing is set', () => {
    expect(costPolicyFromEnv(configFrom({}))).toEqual(DEFAULT_COST_POLICY);
  });

  it('treats an empty value as unset', () => {
    expect(
      costPolicyFromEnv(
        configFrom({
          TRANSLATE_SPECULATION_OVERLAP: '',
          TRANSLATE_SPECULATION_HOMOPHONES: '',
          TRANSLATE_LIVE_COMMIT_SCALE: '',
        }),
      ),
    ).toEqual(DEFAULT_COST_POLICY);
  });

  it('changes exactly the field each key names', () => {
    expect(
      costPolicyFromEnv(configFrom({ TRANSLATE_SPECULATION_OVERLAP: 'off' })),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      speculationOverlap: false,
    });
    expect(
      costPolicyFromEnv(
        configFrom({ TRANSLATE_SPECULATION_HOMOPHONES: 'off' }),
      ),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      speculationHomophones: false,
    });
    expect(
      costPolicyFromEnv(configFrom({ TRANSLATE_LIVE_COMMIT_SCALE: '2' })),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      liveCommitScale: 2,
    });
  });

  it('refuses a value outside the knob', () => {
    expect(() =>
      configFrom({ TRANSLATE_SPECULATION_OVERLAP: 'false' }),
    ).toThrow();
    expect(() => configFrom({ TRANSLATE_LIVE_COMMIT_SCALE: '0.5' })).toThrow();
  });
});
