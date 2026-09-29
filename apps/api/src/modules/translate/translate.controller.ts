import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { TtsVoiceCatalog } from '@chatofy/ai-providers';
import {
  DEFAULT_TRANSLATION_DIRECTION,
  LANGUAGE_CODES,
  directionLanguages,
  languageCodeSchema,
  type TranslateResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { LanguageUnavailableException } from '../../common/exceptions/language-unavailable.exception';
import { TranslateRequestDto, TranslateResponseDto } from './dto/translate.dto';
import { VoicesResponseDto } from './dto/voices.dto';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { SpeechLanguageSupport } from './providers/speech-language-support';
import {
  LANGUAGE_IDENTIFIER,
  type LanguageIdentifier,
} from './session/language-identifier';
import { planForDirection } from './session/turn-language-plan';

/**
 * The language `voices` answers for when the caller names none.
 *
 * Derived from the registry's own default direction rather than written as a
 * literal: it is the language a fresh `vi_to_en` conversation speaks its
 * translation in, which is the voice a client most likely wants before it has
 * asked for anything else.
 */
const DEFAULT_VOICES_LANGUAGE = directionLanguages(
  DEFAULT_TRANSLATION_DIRECTION,
).target;

/**
 * Turn-based translation endpoint. Accepts a complete audio utterance (base64)
 * plus a direction, returns the transcript, the translation, and synthesized
 * speech in the target language.
 *
 * Directions are the ones `TRANSLATION_DIRECTIONS` derives from the language
 * registry in `@chatofy/types`. The raw payload is wrapped by
 * TransformInterceptor.
 *
 * Authenticated, despite what this comment used to say: `JwtAuthGuard` is
 * registered as a global `APP_GUARD` and nothing here is marked `@Public()`, so
 * every route on this controller requires a bearer token.
 */
@ApiTags('translate')
@Controller('translate')
export class TranslateController {
  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly languageSupport: SpeechLanguageSupport,
    @Inject(LANGUAGE_IDENTIFIER)
    private readonly identifier: LanguageIdentifier,
  ) {}

  /**
   * `@ApiBearerAuth()` is written per route here, not on the class, for the same
   * reason `@Public()` is: a class-level mark is inherited silently, and the
   * next route added would then claim an authentication requirement nobody
   * chose for it. It is documentation only — the guard is global — so being
   * explicit costs one line and keeps the padlock honest.
   */
  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Translate an audio utterance to speech in the target language',
    description:
      'Send a complete utterance as base64 audio plus a direction (`vi_to_en` or `en_to_vi`). Answers with the transcript, the translation, and synthesized speech in the target language. This is a ONE-turn, ONE-audio surface: the turn is still translated into every language the conversation language plan calls for, but only the first target (`plan.spoken`) is synthesized and returned — the same budget the streaming path applies to its own preview. The body carries audio, so it is large — the JSON body limit is 12 MB, and anything longer than a short utterance belongs on the WebSocket surface instead.',
  })
  @ApiEnvelopeResponse(TranslateResponseDto)
  @ApiErrorResponses(400, 401, 503)
  async translate(
    @Body() body: TranslateRequestDto,
  ): Promise<TranslateResponse> {
    const audio = Buffer.from(body.audioBase64, 'base64');
    if (audio.length === 0) {
      throw new BadRequestException(
        'audioBase64 did not decode to any audio bytes',
      );
    }
    // Same helper and identifier the WS path uses in
    // `TranslationSessionService.start`, so the two transports never disagree
    // about what a given direction is decided to mean.
    const plan = planForDirection(
      body.direction ?? DEFAULT_TRANSLATION_DIRECTION,
      this.identifier,
    );
    // Checked before any provider call is spent on a language no configured
    // engine serves. REST always returns synthesized audio, so `voiceOutput`
    // is unconditionally true here.
    const languageRefusal = this.languageSupport.refusal({
      recognition: plan.recognition,
      spoken: plan.spoken,
      voiceOutput: true,
    });
    if (languageRefusal) {
      // 503, not 400: the caller asked for nothing malformed, this server
      // simply cannot serve the language right now — the identical fact the
      // WS path reports as its own `language_unavailable` event, in the
      // identical words.
      throw new LanguageUnavailableException(languageRefusal);
    }
    return this.pipeline.translateTurn(
      {
        audio: new Uint8Array(audio),
        mimeType: body.audioMimeType,
        voiceGender: body.voiceGender,
        speed: body.speed,
      },
      plan,
    );
  }

  /**
   * Voices the running speech backend offers for a language.
   *
   * Answered from the backend itself rather than from a list kept here, because
   * which voices exist is a property of whatever is deployed. A client that
   * hardcoded them would be wrong the day `AI_TTS_PROVIDER` changed — and that is
   * not hypothetical: a voice name meant for one backend once reached another and
   * took Vietnamese synthesis down entirely.
   *
   * An empty list is a real answer, meaning "this backend offers no choice", and
   * a client should show gender alone. It is NOT the same as this call failing,
   * and a caller must not collapse the two — a 401 or a stopped sidecar would
   * then be indistinguishable from a backend that simply has one voice.
   */
  @Get('voices')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List the voices the running TTS backend offers',
    description:
      'Answered from the backend itself, not from a list kept in the API, because which voices exist is a property of whatever is deployed. Do not hardcode `token` values — they are opaque and change with the backend. An empty list means this backend offers no choice; show gender alone. That is a successful answer, not a failure.',
  })
  @ApiQuery({
    name: 'language',
    required: false,
    enum: LANGUAGE_CODES,
    description: `Which language to list voices for. Defaults to \`${DEFAULT_VOICES_LANGUAGE}\`.`,
  })
  @ApiEnvelopeResponse(VoicesResponseDto)
  @ApiErrorResponses(400, 401)
  async voices(@Query('language') language?: string): Promise<TtsVoiceCatalog> {
    const parsed = languageCodeSchema.safeParse(
      language ?? DEFAULT_VOICES_LANGUAGE,
    );
    if (!parsed.success) {
      throw new BadRequestException(
        `language must be one of: ${LANGUAGE_CODES.join(', ')}`,
      );
    }
    return this.pipeline.listVoices(parsed.data);
  }
}
