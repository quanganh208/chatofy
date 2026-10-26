import { env } from './env';

/**
 * Whether this build ships video conferencing.
 *
 * A function rather than a constant so specs can mock this module and exercise
 * both states without re-importing everything that reads it. Next inlines the
 * `NEXT_PUBLIC_` value at build time, so in a real bundle this is a constant.
 */
export function isConferenceEnabled(): boolean {
  return env.NEXT_PUBLIC_CONFERENCE_ENABLED === 'true';
}
