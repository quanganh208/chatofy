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

  it('defaults to the cheaper turn the replay measured', () => {
    expect(DEFAULT_COST_POLICY).toEqual({
      speculationOverlap: false,
      speculationHomophones: false,
      liveCommitScale: 3,
    });
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
      costPolicyFromEnv(configFrom({ TRANSLATE_SPECULATION_OVERLAP: 'on' })),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      speculationOverlap: true,
    });
    expect(
      costPolicyFromEnv(configFrom({ TRANSLATE_SPECULATION_HOMOPHONES: 'on' })),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      speculationHomophones: true,
    });
    expect(
      costPolicyFromEnv(configFrom({ TRANSLATE_LIVE_COMMIT_SCALE: '1' })),
    ).toEqual({
      ...DEFAULT_COST_POLICY,
      liveCommitScale: 1,
    });
  });

  it('refuses a value outside the knob', () => {
    expect(() =>
      configFrom({ TRANSLATE_SPECULATION_OVERLAP: 'false' }),
    ).toThrow();
    expect(() => configFrom({ TRANSLATE_LIVE_COMMIT_SCALE: '0.5' })).toThrow();
  });
});
