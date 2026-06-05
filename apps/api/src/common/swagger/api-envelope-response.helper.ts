import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiMetaDto } from './envelope.dto';

/**
 * Documents a successful endpoint as the standard success envelope
 * `{ success: true, data: <dataDto>, meta }` in OpenAPI.
 *
 * Generics can't be inferred by Swagger, so we compose the schema explicitly
 * with `getSchemaPath` + `allOf` and register the referenced models via
 * `@ApiExtraModels`.
 */
export function ApiEnvelopeResponse(
  dataDto: Type<unknown>,
  { status = 200 }: { status?: number } = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiMetaDto, dataDto),
    ApiResponse({
      status,
      schema: {
        allOf: [
          {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { $ref: getSchemaPath(dataDto) },
              meta: { $ref: getSchemaPath(ApiMetaDto) },
            },
            required: ['success', 'data', 'meta'],
          },
        ],
      },
    }),
  );
}
