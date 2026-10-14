import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import {
  HOMOPHONE_REPAIR_TIMEOUT_MS,
  OpenAiCompatibleLoanwordRespeller,
  parseCorrections,
  parseProposals,
  RESPELL_TIMEOUT_MS,
} from './openai-compatible-loanword-respeller.js';
import {
  HOMOPHONE_REPAIR_INSTRUCTION,
  LOANWORD_RESPELLING_INSTRUCTION,
  LOANWORD_RESPELLING_INSTRUCTION_HAN,
} from './loanword-respelling-prompt.js';
import { RECOGNIZER_FUSION_INSTRUCTION } from './recognizer-fusion-prompt.js';

/**
 * The wire shape and what the provider believes coming back. How a model
 * answers the prompt is `benchmarks/prompt-injection`'s and
 * `benchmarks/loanword-respelling`'s question, not a unit test's.
 */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const REQUEST = {
  transcript: 'lợi dụng deep fred để lừa đảo',
  translation: 'exploiting deepfakes for fraud',
  spans: ['deep fred'],
};

function answering(content: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, request: unknown) => {
    calls.push(JSON.parse((request as { body: string }).body) as Record<string, unknown>);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => 'refused',
    } as Response;
  }) as typeof fetch;
  return calls;
}

const respeller = () =>
  new OpenAiCompatibleLoanwordRespeller({
    apiKey: 'test-key',
    baseUrl: 'https://host.example/',
    model: 'flash',
    extraBody: { thinking: { type: 'disabled' } },
  });

describe('OpenAiCompatibleLoanwordRespeller', () => {
  it('sends one JSON-mode request carrying the host row fields and the data as JSON', async () => {
    const calls = answering('{"deep fred": "deepfake"}');
    await expect(respeller().respell(REQUEST)).resolves.toEqual({ 'deep fred': 'deepfake' });

    expect(calls).toHaveLength(1);
    const body = calls[0]!;
    expect(body.model).toBe('flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBeUndefined();
    const [system, user] = body.messages as { role: string; content: string }[];
    expect(system).toEqual({ role: 'system', content: LOANWORD_RESPELLING_INSTRUCTION });
    expect(JSON.parse(user!.content)).toEqual(REQUEST);
  });

  it('asks for the rendering too when the translation is written in Han characters', async () => {
    const calls = answering('{"bungary": {"spelling": "Bulgaria", "rendering": "保加利亚"}}');
    const request = {
      transcript: 'bungary đang điều tra',
      translation: '保加利亚正在调查',
      spans: ['bungary'],
      translationInHan: true,
    };
    await expect(respeller().respell(request)).resolves.toEqual({
      bungary: { spelling: 'Bulgaria', rendering: '保加利亚' },
    });

    const [system, user] = calls[0]!.messages as { role: string; content: string }[];
    expect(system!.content).toBe(LOANWORD_RESPELLING_INSTRUCTION_HAN);
    // The flag picks the instruction; it is not data the model reads.
    expect(JSON.parse(user!.content)).toEqual({
      transcript: request.transcript,
      translation: request.translation,
      spans: request.spans,
    });
  });

  it('asks nothing when there is no span', async () => {
    const calls = answering('{}');
    await expect(respeller().respell({ ...REQUEST, spans: [] })).resolves.toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('throws a response error on a non-2xx answer', async () => {
    answering('', { ok: false, status: 429 });
    await expect(respeller().respell(REQUEST)).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('refuses to construct without a key', () => {
    expect(() => new OpenAiCompatibleLoanwordRespeller({ baseUrl: 'x', model: 'y' })).toThrow(
      ProviderConfigError,
    );
  });
});

describe('repairHomophones', () => {
  it('sends the transcript and the sentences before it, and returns the list unchecked', async () => {
    const calls = answering('{"corrections": [{"heard": "đâm giao", "said": "đâm dao"}, "junk"]}');
    await expect(
      respeller().repairHomophones({
        transcript: 'một vụ đâm giao',
        before: ['tin buổi sáng'],
      }),
    ).resolves.toEqual([{ heard: 'đâm giao', said: 'đâm dao' }, 'junk']);

    const [system, user] = calls[0]!.messages as { role: string; content: string }[];
    expect(system!.content).toBe(HOMOPHONE_REPAIR_INSTRUCTION);
    expect(JSON.parse(user!.content)).toEqual({
      before: ['tin buổi sáng'],
      transcript: 'một vụ đâm giao',
    });
  });

  it('gives a repair its own, longer ceiling than a respelling', async () => {
    // The turn's wait is bounded by the caller's grace; a fixed 1.2 s here
    // would lose repairs whenever the host, and so the translation, is slow.
    answering('{"corrections": []}');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await respeller().repairHomophones({ transcript: 'một vụ đâm giao', before: [] });
    await respeller().respell(REQUEST);

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      HOMOPHONE_REPAIR_TIMEOUT_MS,
      RESPELL_TIMEOUT_MS,
    ]);
  });

  it('asks nothing about an empty transcript', async () => {
    const calls = answering('{"corrections": []}');
    await expect(respeller().repairHomophones({ transcript: ' ', before: [] })).resolves.toEqual(
      [],
    );
    expect(calls).toHaveLength(0);
  });
});

describe('fuseRecognizers', () => {
  it('sends both transcripts and the sentences before, and returns the text unchecked', async () => {
    const calls = answering('{"text": "một vụ đâm dao"}');
    await expect(
      respeller().fuseRecognizers({
        transcript: 'một vụ đâm giao',
        alternates: ['một vụ đâm dao'],
        before: ['tin buổi sáng'],
      }),
    ).resolves.toBe('một vụ đâm dao');

    const [system, user] = calls[0]!.messages as { role: string; content: string }[];
    expect(system!.content).toBe(RECOGNIZER_FUSION_INSTRUCTION);
    expect(JSON.parse(user!.content)).toEqual({
      before: ['tin buổi sáng'],
      A: 'một vụ đâm giao',
      B: 'một vụ đâm dao',
    });
  });

  it('runs under the repair’s ceiling', async () => {
    answering('{"text": "x"}');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await respeller().fuseRecognizers({ transcript: 'x', alternates: ['y'], before: [] });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([HOMOPHONE_REPAIR_TIMEOUT_MS]);
  });

  it('asks nothing without a transcript or an alternate, and reads junk as nothing', async () => {
    const calls = answering('not json');
    await expect(
      respeller().fuseRecognizers({ transcript: ' ', alternates: ['y'], before: [] }),
    ).resolves.toBeUndefined();
    await expect(
      respeller().fuseRecognizers({ transcript: 'x', alternates: [], before: [] }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    await expect(
      respeller().fuseRecognizers({ transcript: 'x', alternates: ['y'], before: [] }),
    ).resolves.toBeUndefined();
  });
});

describe('parseCorrections', () => {
  it.each(['not json', '[]', '{"corrections": "x"}', '{}', ''])(
    'reads %j as no corrections',
    (content) => {
      expect(parseCorrections(content)).toEqual([]);
    },
  );
});

describe('parseProposals', () => {
  it('keeps a spelling with its rendering only when renderings were asked for', () => {
    const content =
      '{"bungary": {"spelling": "Bulgaria", "rendering": "保加利亚"}, "mata": "Malta"}';
    expect(parseProposals(content, ['bungary', 'mata'], true)).toEqual({
      bungary: { spelling: 'Bulgaria', rendering: '保加利亚' },
    });
    expect(parseProposals(content, ['bungary', 'mata'])).toEqual({ mata: 'Malta' });
  });

  it('never reads an inherited member as an answer', () => {
    expect(parseProposals('{}', ['constructor', 'toString'])).toEqual({});
  });

  it('keeps only the spans asked, as strings or null', () => {
    expect(
      parseProposals('{"deep fred": "deepfake", "ok": null, "other": "x", "n": 3}', [
        'deep fred',
        'ok',
        'n',
      ]),
    ).toEqual({ 'deep fred': 'deepfake', ok: null });
  });

  it.each(['not json', '[]', 'null', ''])('reads %j as no proposals', (content) => {
    expect(parseProposals(content, ['deep fred'])).toEqual({});
  });
});
