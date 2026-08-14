import { Logger } from '@nestjs/common';
import type { ServerEvent, SessionOptions } from '@chatofy/types';
import { StreamingCommitDriver } from './streaming-commit-driver';
import { TurnSession } from './turn-session';
import { EventChannel } from './event-channel';
import type { StreamSocket } from './stream-socket';
import type { PipelineTranslatorService } from '../services/pipeline-translator.service';

const STREAMING: SessionOptions = {
  direction: 'vi_to_en',
  voiceGender: 'female',
  streaming: true,
};
const PLAIN: SessionOptions = { ...STREAMING, streaming: false };

/** A 24 kHz mono PCM16 WAV of `ms` silence, as the TTS sidecar would return. */
function wav(ms: number): Uint8Array {
  const rate = 24000;
  const samples = Math.round((rate * ms) / 1000);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

class FakeSocket implements StreamSocket {
  readonly events: ServerEvent[] = [];
  send(raw: string): void {
    this.events.push(JSON.parse(raw) as ServerEvent);
  }
  ofType<T extends ServerEvent['type']>(
    type: T,
  ): Extract<ServerEvent, { type: T }>[] {
    return this.events.filter(
      (e): e is Extract<ServerEvent, { type: T }> => e.type === type,
    );
  }
}

function harness(options: SessionOptions = STREAMING) {
  const translate = jest.fn().mockResolvedValue('good morning,');
  const synthesize = jest.fn().mockResolvedValue({
    bytes: wav(120),
    mimeType: 'audio/wav',
  });
  const pipeline = {
    translate,
    synthesize,
  } as unknown as PipelineTranslatorService;
  const logger = new Logger('test');
  jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  const driver = new StreamingCommitDriver(pipeline, logger);
  const session = new TurnSession(options);
  const socket = new FakeSocket();
  const channel = new EventChannel(socket, logger, session);
  return { driver, session, socket, channel, translate, synthesize };
}

/** Let the driver's fire-and-forget chain settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('StreamingCommitDriver', () => {
  it('speaks a settled clause while the speaker is still talking', async () => {
    const { driver, session, socket, channel } = harness();
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();

    expect(socket.ofType('server.audio.frame').length).toBeGreaterThan(0);
    const commits = socket.ofType('server.translation.commit');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ text: 'good morning,', seq: 0 });
  });

  it('sends the audio before the text that captions it', async () => {
    // The commit event describes sound the listener is already hearing. Leading
    // with the text would show a clause that has not been spoken yet — the one
    // ordering this feature promises never to produce.
    const { driver, session, socket, channel } = harness();
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();

    const firstAudio = socket.events.findIndex(
      (e) => e.type === 'server.audio.frame',
    );
    const commit = socket.events.findIndex(
      (e) => e.type === 'server.translation.commit',
    );
    expect(firstAudio).toBeGreaterThanOrEqual(0);
    expect(firstAudio).toBeLessThan(commit);
  });

  it('does nothing at all on a turn that did not ask to stream', async () => {
    const { driver, session, socket, channel, translate } = harness(PLAIN);
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();

    expect(translate).not.toHaveBeenCalled();
    expect(socket.events).toHaveLength(0);
  });

  it('tells the translator what has already been spoken', async () => {
    const { driver, session, channel, translate } = harness();
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();
    driver.onPartial(
      session,
      channel,
      () => true,
      'Chào buổi sáng, tôi là Nam, rất vui được gặp bạn,',
    );
    await settle();

    // Without this the model has no way to know a translation is in progress and
    // produces a whole-sentence answer that repeats what was already heard.
    expect(translate).toHaveBeenLastCalledWith(
      expect.objectContaining({ context: ['good morning,'] }),
    );
  });

  it('never re-speaks a clause it has already said', async () => {
    const { driver, session, socket, channel } = harness();
    const read = 'Chào buổi sáng, tôi là';
    driver.onPartial(session, channel, () => true, read);
    await settle();
    // The same audio decoded again, as happens on every partial tick.
    driver.onPartial(session, channel, () => true, read);
    await settle();

    expect(socket.ofType('server.translation.commit')).toHaveLength(1);
  });

  it('numbers commits so a client can spot a dropped one', async () => {
    const { driver, session, socket, channel } = harness();
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();
    driver.onPartial(
      session,
      channel,
      () => true,
      'Chào buổi sáng, tôi là Nam, rất vui được gặp bạn,',
    );
    await settle();

    expect(
      socket.ofType('server.translation.commit').map((e) => e.seq),
    ).toEqual([0, 1]);
  });

  it('matches the clause ending to what the speaker actually did', async () => {
    // The model returns a full stop for a clause the speaker ran straight
    // through. Spoken, that closes the phrase and drops the pitch mid-sentence.
    const { driver, session, socket, channel, translate, synthesize } =
      harness();
    translate.mockResolvedValueOnce('Good morning.');
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();

    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Good morning,' }),
    );
    // The caption must say what was spoken, not what the model first produced.
    expect(socket.ofType('server.translation.commit')[0]).toMatchObject({
      text: 'Good morning,',
    });
  });

  it('stops without speaking when the client has gone', async () => {
    const { driver, session, socket, channel } = harness();
    driver.onPartial(session, channel, () => false, 'Chào buổi sáng, tôi là');
    await settle();

    expect(socket.events).toHaveLength(0);
  });

  it('stays quiet rather than failing when translation throws', async () => {
    // A mid-turn courtesy: `end()` still answers the turn, and an error thrown
    // at someone mid-sentence helps nobody.
    const { driver, session, socket, channel, translate } = harness();
    translate.mockRejectedValueOnce(new Error('rate limited'));
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    await settle();

    expect(socket.ofType('server.translation.commit')).toHaveLength(0);
  });

  it('releases the remainder when the turn ends', () => {
    const { driver, session, channel } = harness();
    driver.onPartial(session, channel, () => true, 'Chào buổi sáng, tôi là');
    // No await: `finalClause` is synchronous and reads the committer directly.
    const remainder = driver.finalClause(session, 'Chào buổi sáng, tôi là Nam');
    expect(remainder).toContain('Nam');
  });

  it('reports nothing left when the turn ended on a boundary', () => {
    const { driver, session, channel } = harness(PLAIN);
    expect(driver.finalClause(session, 'anything at all')).toBe('');
    expect(channel).toBeDefined();
  });
});
