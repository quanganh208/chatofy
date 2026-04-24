import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Generic Zod validation pipe.
 * Usage: @Body(new ZodValidationPipe(MySchema)) body: MyType
 *
 * Throws BadRequestException with formatted Zod errors on parse failure.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const messages = result.error.errors.map((e) => `[${e.path.join('.')}] ${e.message}`);
      throw new BadRequestException({
        message: messages,
        error: 'Validation failed',
      });
    }
    return result.data;
  }
}
