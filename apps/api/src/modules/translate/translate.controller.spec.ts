import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import { InMemoryCreditLedger } from '../../../test/utils/in-memory-credit-ledger';
import { CodedHttpException } from '../../common/exceptions/coded-http.exception';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { START_MIN_CREDIT_SECONDS } from '../credits/credit-pricing';
import { TranslateRequestDto } from './dto/translate.dto';
import { TranslateController } from './translate.controller';
import { LanguageUnavailableException } from '../../common/exceptions/language-unavailable.exception';
import { DeclaredLanguageIdentifier } from './session/language-identifier';
import type { PipelineTranslatorService } from './services/pipeline-translator.service';
import type { SpeechLanguageSupport } from './providers/speech-language-support';

/**
 * The one thing worth a dedicated unit test on this controller: a language no
 * configured engine serves has to answer with a status the CALLER did not
 * cause, not a 400 that tells someone who sent a perfectly valid request to go
 * fix it.
 */

const REQUEST: TranslateRequestDto = {
  audioBase64: Buffer.from('audio').toString('base64'),
  audioMimeType: 'audio/webm',
  languagePair: { source: 'vi', target: 'en' },
  voiceGender: 'female',
  speed: 1,
};

const USER_ID = 'user-1';
const HTTP = { auth: { userId: USER_ID } } as unknown as Request;

function controllerWith(
  refusal: string | null,
  ledger: InMemoryCreditLedger = fundedLedger(10),
): {
  controller: TranslateController;
  translateTurn: ReturnType<typeof vi.fn>;
} {
  const translateTurn = vi.fn().mockResolvedValue({
    sourceText: 'xin chào',
    targetText: 'hello',
    audioBase64: '',
    audioMimeType: 'audio/mpeg',
  });
  const pipeline = { translateTurn } as unknown as PipelineTranslatorService;
  const languageSupport = {
    refusal: vi.fn().mockReturnValue(refusal),
  } as unknown as SpeechLanguageSupport;
  const controller = new TranslateController(
    pipeline,
    languageSupport,
    new DeclaredLanguageIdentifier(),
    ledger,
  );
  return { controller, translateTurn };
}

/** A ledger whose one user holds `credits` whole credits and no Free grant. */
function fundedLedger(credits: number): InMemoryCreditLedger {
  const ledger = new InMemoryCreditLedger({ freeCredits: 0 });
  if (credits > 0) ledger.seed(USER_ID, credits);
  return ledger;
}

describe('TranslateController', () => {
  it('answers a missing engine with a 503 LanguageUnavailableException, not a 400', async () => {
    const { controller } = controllerWith(
      'This server cannot speak fr right now',
    );

    const attempt = controller.translate(HTTP, REQUEST);

    await expect(attempt).rejects.toBeInstanceOf(LanguageUnavailableException);
    await expect(attempt).rejects.toMatchObject({
      message: 'This server cannot speak fr right now',
    });
  });

  it('reports the exact 503 status the caller sees', async () => {
    const { controller } = controllerWith(
      'This server cannot speak fr right now',
    );

    try {
      await controller.translate(HTTP, REQUEST);
      expect.unreachable('expected the language refusal to throw');
    } catch (err) {
      expect((err as LanguageUnavailableException).getStatus()).toBe(503);
    }
  });

  it('translates normally when the language is served', async () => {
    const { controller } = controllerWith(null);

    await expect(controller.translate(HTTP, REQUEST)).resolves.toMatchObject({
      targetText: 'hello',
    });
  });

  it('refuses an account under one credit with 402 CREDITS_EXHAUSTED before any provider call', async () => {
    const ledger = new InMemoryCreditLedger({ freeCredits: 0 });
    await ledger.grant({
      userId: USER_ID,
      source: 'promo',
      amount: START_MIN_CREDIT_SECONDS - 1,
      externalRef: 'promo:short',
    });
    const { controller, translateTurn } = controllerWith(null, ledger);

    const err = await controller
      .translate(HTTP, REQUEST)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedHttpException);
    expect((err as CodedHttpException).code).toBe('CREDITS_EXHAUSTED');
    expect((err as CodedHttpException).getStatus()).toBe(402);
    expect(translateTurn).not.toHaveBeenCalled();
  });

  it('admits exactly one credit, and charges nothing for the turn', async () => {
    const ledger = new InMemoryCreditLedger({ freeCredits: 0 });
    await ledger.grant({
      userId: USER_ID,
      source: 'promo',
      amount: START_MIN_CREDIT_SECONDS,
      externalRef: 'promo:one',
    });
    const { controller } = controllerWith(null, ledger);

    await expect(controller.translate(HTTP, REQUEST)).resolves.toMatchObject({
      targetText: 'hello',
    });
    expect((await ledger.balance(USER_ID)).available).toBe(
      START_MIN_CREDIT_SECONDS,
    );
  });

  it('fails closed with 503 when the balance cannot be read', async () => {
    const ledger = fundedLedger(10);
    ledger.setUnavailable(true);
    const { controller, translateTurn } = controllerWith(null, ledger);

    await expect(controller.translate(HTTP, REQUEST)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(translateTurn).not.toHaveBeenCalled();
  });

  it('is throttled per account', () => {
    // Read through the descriptor: the route handler is metadata's key here,
    // never called, so taking it off the prototype unbound is the point.
    const handler = Object.getOwnPropertyDescriptor(
      TranslateController.prototype,
      'translate',
    )?.value as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toContain(UserThrottlerGuard);
  });

  // The undeclared source is a streaming-session value only. REST keeps the
  // declared pair, so the global pipe — the one `AllExceptionsFilter` maps to
  // 400 VALIDATION_FAILED — refuses it before the controller runs.
  it('refuses a detect source with a 400 validation failure, before the controller runs', () => {
    const pipe = new ZodValidationPipe();
    const body = {
      ...REQUEST,
      languagePair: { source: 'detect', target: 'en' },
    };

    let thrown: unknown;
    try {
      pipe.transform(body, { type: 'body', metatype: TranslateRequestDto });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ZodValidationException);
    expect((thrown as ZodValidationException).getStatus()).toBe(400);
  });

  it('still takes a declared pair through the same pipe', () => {
    const pipe = new ZodValidationPipe();
    expect(
      pipe.transform(REQUEST, { type: 'body', metatype: TranslateRequestDto }),
    ).toMatchObject({ languagePair: { source: 'vi', target: 'en' } });
  });
});
