import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import { HISTORY_LIMITS, type ConversationSummary } from '@chatofy/types';
import { ConversationsController } from './conversations.controller';
import type { ConversationsService } from './conversations.service';
import {
  RenameConversationRequestDto,
  type ConversationIdParamDto,
} from './dto/conversations.dto';

const req = { auth: { userId: 'u1' } } as unknown as Request;
const params: ConversationIdParamDto = {
  conversationId: '6f1c2b1e-8d4a-4f7e-9a3b-2c5d7e9f1a2b',
};

const summary: ConversationSummary = {
  conversationId: params.conversationId,
  languages: ['vi', 'en'],
  startedAt: '2026-11-04T02:00:00.000Z',
  endedAt: '2026-11-04T02:10:00.000Z',
  turnCount: 2,
  preview: 'Mình muốn thuê căn hộ',
  hasMinutes: false,
  pausedMs: 0,
  title: 'Thuê căn hộ',
  kind: 'one-way',
  hasRecording: false,
  speakerCount: 1,
  speakers: ['Lan'],
};

function makeController(service: Partial<ConversationsService>) {
  return new ConversationsController(service as ConversationsService);
}

/** The global pipe, as it runs on the PATCH body before the controller does. */
function validateRename(body: unknown): unknown {
  return new ZodValidationPipe().transform(body, {
    type: 'body',
    metatype: RenameConversationRequestDto,
  });
}

function refusal(body: unknown): unknown {
  try {
    validateRename(body);
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('ConversationsController rename', () => {
  it('renames with the owner taken from the verified token and wraps the summary', async () => {
    const rename = vi.fn().mockResolvedValue(summary);
    const controller = makeController({ rename });

    await expect(
      controller.rename(req, params, { title: 'Thuê căn hộ' }),
    ).resolves.toEqual({ conversation: summary });
    expect(rename).toHaveBeenCalledWith('u1', params.conversationId, {
      title: 'Thuê căn hộ',
    });
  });

  it('passes the 404 for a conversation the caller does not own through unchanged', async () => {
    const notFound = new NotFoundException('no conversation');
    const controller = makeController({
      rename: vi.fn().mockRejectedValue(notFound),
    });

    await expect(controller.rename(req, params, { title: 'x' })).rejects.toBe(
      notFound,
    );
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a whitespace-only title', { title: '   \t ' }],
    [
      'a title over the ceiling',
      { title: 'a'.repeat(HISTORY_LIMITS.MAX_TITLE_CHARS + 1) },
    ],
    ['a missing title', {}],
    ['a non-string title', { title: 42 }],
  ])('refuses %s with a 400 before the controller runs', (_label, body) => {
    const thrown = refusal(body);

    expect(thrown).toBeInstanceOf(ZodValidationException);
    expect((thrown as ZodValidationException).getStatus()).toBe(400);
  });

  it('trims the title before the controller sees it', () => {
    expect(validateRename({ title: '  Thuê căn hộ \n' })).toEqual({
      title: 'Thuê căn hộ',
    });
  });

  it('takes a title of exactly the ceiling, measured after trimming', () => {
    const title = 'a'.repeat(HISTORY_LIMITS.MAX_TITLE_CHARS);
    expect(validateRename({ title: `  ${title}  ` })).toEqual({ title });
  });
});
