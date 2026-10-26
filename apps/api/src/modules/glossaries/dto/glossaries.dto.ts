import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  glossaryItemListResponseSchema,
  glossaryItemSchema,
  glossaryListResponseSchema,
  glossarySchema,
  patchGlossaryRequestSchema,
  saveGlossaryItemRequestSchema,
  saveGlossaryRequestSchema,
} from '@chatofy/types';

export const glossaryIdParamSchema = z.object({ glossaryId: z.uuid() });
export const itemIdParamSchema = z.object({
  glossaryId: z.uuid(),
  itemId: z.uuid(),
});

export class SaveGlossaryRequestDto extends createZodDto(
  saveGlossaryRequestSchema,
) {}
export class PatchGlossaryRequestDto extends createZodDto(
  patchGlossaryRequestSchema,
) {}
export class SaveGlossaryItemRequestDto extends createZodDto(
  saveGlossaryItemRequestSchema,
) {}

export class GlossaryIdParamDto extends createZodDto(glossaryIdParamSchema) {}
export class ItemIdParamDto extends createZodDto(itemIdParamSchema) {}

export class GlossaryResponseDto extends createZodDto(
  z.object({ glossary: glossarySchema }),
) {}
export class GlossaryListResponseDto extends createZodDto(
  glossaryListResponseSchema,
) {}
export class GlossaryItemResponseDto extends createZodDto(
  z.object({ item: glossaryItemSchema }),
) {}
export class GlossaryItemListResponseDto extends createZodDto(
  glossaryItemListResponseSchema,
) {}
