import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Generic Zod validation pipe.
 * Usage: @Body(new ZodValidationPipe(mySchema))
 *
 * Throws BadRequestException with formatted zod issues on failure.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new BadRequestException({ message: 'Validation failed', issues });
    }
    return result.data;
  }
}
