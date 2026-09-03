import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { MeetingMinutes } from '@chatofy/types';
import { MinutesController } from './minutes.controller';
import type { MinutesService } from './minutes.service';
import type { ConversationIdParamDto } from '../conversations/dto/conversations.dto';
import type { GenerateMinutesRequestDto } from './dto/minutes.dto';

const ready: MeetingMinutes = {
  conversationId: 'c1',
  status: 'ready',
  summary: 'summary',
  keyPoints: [],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-08-30T00:00:00.000Z',
  model: 'gemini-3.5-flash',
};

const req = { auth: { userId: 'u1' } } as unknown as Request;
const params: ConversationIdParamDto = { conversationId: 'c1' };
// The whole body now: the transcript is named by the URL, not carried.
const body = { language: 'en' } as GenerateMinutesRequestDto;

function makeController(service: Partial<MinutesService>) {
  return new MinutesController(service as MinutesService);
}

describe('MinutesController', () => {
  it('generates with the owner taken from the verified token, not the path', async () => {
    const generate = jest.fn().mockResolvedValue(ready);
    const controller = makeController({ generate });

    const result = await controller.generate(req, params, body);

    expect(result).toEqual({ minutes: ready });
    expect(generate).toHaveBeenCalledWith('u1', 'c1', body);
  });

  it('returns the stored minutes on GET', async () => {
    const controller = makeController({
      get: jest.fn().mockResolvedValue(ready),
    });
    await expect(controller.get(req, params)).resolves.toEqual({
      minutes: ready,
    });
  });

  it('404s when the caller has no minutes for the conversation', async () => {
    const controller = makeController({
      get: jest.fn().mockResolvedValue(null),
    });
    await expect(controller.get(req, params)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads by the token owner, not a path/body user', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const controller = makeController({ get });
    await expect(controller.get(req, params)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(get).toHaveBeenCalledWith('u1', 'c1');
  });
});
