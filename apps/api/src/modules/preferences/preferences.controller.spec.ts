import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import {
  defaultUserPreferences,
  type PreferencesResponse,
} from '@chatofy/types';
import { PreferencesController } from './preferences.controller';
import type { PreferencesService } from './preferences.service';
import { UpdatePreferencesRequestDto } from './dto/preferences.dto';

const req = { auth: { userId: 'user-1' } } as unknown as Request;
const answer: PreferencesResponse = {
  preferences: defaultUserPreferences('en'),
  updatedAt: null,
};

function makeController(service: Partial<PreferencesService>) {
  return new PreferencesController(service as PreferencesService);
}

/** The global pipe, as it runs on the PATCH body before the controller does. */
function refusal(body: unknown): unknown {
  try {
    new ZodValidationPipe().transform(body, {
      type: 'body',
      metatype: UpdatePreferencesRequestDto,
    });
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('PreferencesController', () => {
  it('reads, patches and resets with the owner taken from the verified token', async () => {
    const get = vi.fn().mockResolvedValue(answer);
    const update = vi.fn().mockResolvedValue(answer);
    const reset = vi.fn().mockResolvedValue(answer);
    const controller = makeController({ get, update, reset });

    await expect(controller.get(req)).resolves.toBe(answer);
    await expect(
      controller.update(req, { preferences: { theme: 'dark' } }),
    ).resolves.toBe(answer);
    await expect(controller.reset(req)).resolves.toBe(answer);

    expect(get).toHaveBeenCalledWith('user-1');
    expect(update).toHaveBeenCalledWith('user-1', { theme: 'dark' });
    expect(reset).toHaveBeenCalledWith('user-1');
  });

  it('accepts a partial patch at the boundary', () => {
    expect(
      refusal({
        preferences: {
          theme: 'system',
          voices: { en: { speed: 1.5 } },
          pairs: { mobile: { source: 'detect', target: 'vi' } },
          conferenceLanguage: null,
        },
      }),
    ).toBeUndefined();
  });

  it.each([
    [
      'an unknown field, rather than dropping it silently',
      { preferences: { colour: 'red' } },
    ],
    ['a value outside its enum', { preferences: { theme: 'sepia' } }],
    [
      'a speed outside its range',
      { preferences: { voices: { en: { speed: 9 } } } },
    ],
    ['a body without the preferences wrapper', { theme: 'dark' }],
  ])('refuses %s with a validation error', (_label, body) => {
    expect(refusal(body)).toBeInstanceOf(ZodValidationException);
  });
});
