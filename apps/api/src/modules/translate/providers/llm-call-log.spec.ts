import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatLlmCall, logLlmCall } from './llm-call-log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logLlmCall', () => {
  it('writes one line with every field', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    logLlmCall({
      kind: 'translate',
      purpose: 'speculation',
      host: 'commandcode',
      model: 'deepseek/deepseek-v4-flash-fast',
      ms: 1878,
      ok: true,
      inputTokens: 412,
      outputTokens: 31,
      cachedInputTokens: 384,
      promptHash: 'a1b2c3d4',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe(
      'llm kind=translate purpose=speculation host=commandcode model=deepseek/deepseek-v4-flash-fast ' +
        'ms=1878 ok=1 in=412 out=31 cached=384 h=a1b2c3d4',
    );
  });

  it('prints a dash for a missing lane or token count', () => {
    expect(
      formatLlmCall({
        kind: 'homophones',
        host: 'deepseek',
        model: 'deepseek-flash',
        ms: 2501,
        ok: false,
        promptHash: '00ff00ff',
      }),
    ).toBe(
      'llm kind=homophones purpose=- host=deepseek model=deepseek-flash ms=2501 ok=0 in=- out=- cached=- h=00ff00ff',
    );
  });
});
