import { ApiProperty } from '@nestjs/swagger';
import type { TtsVoice } from '@chatofy/ai-providers';
import type { VoiceGender } from '@chatofy/types';

/**
 * One voice `GET /translate/voices` offers, as a caller sees it.
 *
 * Hand-written with `@ApiProperty` rather than derived through `createZodDto`,
 * because `TtsVoice` is a provider-contract INTERFACE and has no zod schema to
 * derive from. `implements TtsVoice` is what keeps the two from drifting: a
 * field added to the contract stops this file compiling.
 */
export class TtsVoiceDto implements TtsVoice {
  @ApiProperty({
    description:
      'How the running backend addresses this voice. OPAQUE — an integer id to one engine, a preset name to another. Send it back verbatim; never parse it or hardcode one.',
    example: 'p225',
  })
  token!: string;

  @ApiProperty({
    description: 'Human-readable name, written by someone who listened to it.',
    example: 'Linh (warm, northern)',
  })
  label!: string;

  @ApiProperty({
    description: 'The one portable way of naming a voice across backends.',
    enum: ['female', 'male'],
    example: 'female',
  })
  gender!: VoiceGender;
}

/**
 * `GET /translate/voices` success payload.
 *
 * An EMPTY list is a real answer meaning "this backend offers no choice", and a
 * client should fall back to picking by gender alone. It is not the same as the
 * call failing — collapsing the two makes a stopped sidecar indistinguishable
 * from a backend that simply has one voice.
 */
export class VoicesResponseDto {
  @ApiProperty({ type: [TtsVoiceDto] })
  voices!: TtsVoiceDto[];
}
