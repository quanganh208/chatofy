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
 *
 * `description` defaults to a line naming where the payload lives rather than
 * being left blank. Swagger UI prints the description beside the status, and an
 * empty one renders as a bare `200` — which reads as an undocumented response
 * next to the failure statuses, all of which say what they mean. Pass a real
 * one wherever the success case has something route-specific to say (what a 202
 * has accepted but not finished, for instance).
 */
export function ApiEnvelopeResponse(
  dataDto: Type<unknown>,
  {
    status = 200,
    description = 'Success. The payload is in `data`; `meta.requestId` correlates it with the logs.',
  }: { status?: number; description?: string } = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiMetaDto, dataDto),
    ApiResponse({
      status,
      description,
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
