/**
 * Drives the real `/ws/translate` with real speech and times what comes back.
 *
 * Opt-in, because it is not a test: it needs the whole stack up and it spends
 * real translation quota, roughly one request per turn against a per-model
 * daily allowance. Nothing here asserts a latency — a threshold would only
 * measure the machine it last ran on. It reports numbers and leaves the
 * judgement to whoever reads them.
 *
 *   pnpm dev:all                                   # api + stt + tts
 *   node benchmarks/realtime/generate-fixtures.mjs  # once
 *   MEASURE_PIPELINE=1 TURN_METRICS_PATH=... pnpm --filter web exec vitest run
 *
 * Frames are paced in real time rather than pushed as fast as the socket will
 * take them. That is the whole point: the early transcription is supposed to
 * run *during* the silence the speaker leaves at the end, so a run that
 * delivers a turn instantly measures a head start that never had time to
 * happen and reports it as worthless.
 *
 * What this cannot see: it replaces the browser with the pump alone. The
 * worklet, `getUserMedia`, the Web Audio clock and the real resampler are all
 * absent, and every defect this project has shipped so far lived in exactly
 * that gap. Treat a green run here as evidence about the server, not about the
 * app.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapturePump } from './capture-pump.js';
import { downsampleToPcm16, pcm16ToBase64, TARGET_SAMPLE_RATE } from './pcm-resampler.js';

const WORKLET_BLOCK_SAMPLES = 1024;
const FIXTURE_RATE = 48000;
const BLOCK_MS = (WORKLET_BLOCK_SAMPLES / FIXTURE_RATE) * 1000;
/** Silence the gate still has to hear after the guess before it ends the turn. */
const REMAINING_HANGOVER_MS = 350;
const WS_URL = process.env.TRANSLATE_WS_URL ?? 'ws://127.0.0.1:3000/ws/translate';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'benchmarks', 'realtime', 'fixtures');

interface Turn {
  id: string;
  commas: number;
  text: string;
  file: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function readWavAsFloat(path: string): Float32Array {
  const buffer = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buffer.readInt16LE(offset + 8 + i * 2) / 0x8000;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

/** One step of the script the pump produced for a turn. */
type Step = { kind: 'audio'; block: Int16Array } | { kind: 'speculate' } | { kind: 'end' };

/**
 * Run a fixture through the pump offline and record what it decided to do.
 *
 * Deriving the script from the pump rather than writing one by hand is the
 * point: a hand-written sequence measures the timing someone imagined, which
 * is how the defect this harness exists for went unnoticed in the first place.
 */
function scriptFor(samples: Float32Array): Step[] {
  const steps: Step[] = [];
  const pump = new CapturePump(
    {
      onTurnOpen: (preRoll) => {
        for (const block of preRoll) steps.push({ kind: 'audio', block });
      },
      onAudio: (block) => steps.push({ kind: 'audio', block }),
      onProbableEnd: () => steps.push({ kind: 'speculate' }),
      onTurnClose: () => steps.push({ kind: 'end' }),
      onLevel: () => {},
    },
    Math.floor(WORKLET_BLOCK_SAMPLES / (FIXTURE_RATE / TARGET_SAMPLE_RATE)),
  );

  for (
    let offset = 0;
    offset + WORKLET_BLOCK_SAMPLES <= samples.length;
    offset += WORKLET_BLOCK_SAMPLES
  ) {
    pump.push(
      downsampleToPcm16(samples.subarray(offset, offset + WORKLET_BLOCK_SAMPLES), FIXTURE_RATE),
    );
  }
  // The fixture ends on the last syllable; a microphone would carry on. Give
  // the gate the silence it needs to call the turn over.
  if (!steps.some((step) => step.kind === 'end')) steps.push({ kind: 'end' });
  return steps;
}

interface Measured {
  id: string;
  /** Endpoint → first sample of translated audio, as the speaker experiences it. */
  firstAudioMs: number;
  /** Endpoint → the transcript arriving, i.e. the text half alone. */
  transcriptMs: number;
  error?: string;
}

async function measureTurn(id: string, steps: Step[]): Promise<Measured> {
  const socket = new WebSocket(WS_URL);
  let sessionId = '';
  let sequence = 0;
  let endpointAt = 0;
  let firstAudioAt = 0;
  let transcriptAt = 0;
  let failure = '';

  const send = (event: unknown) =>
    socket.send(JSON.stringify({ event: (event as { type: string }).type, data: event }));

  const ready = new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error('socket error'));
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as {
        type: string;
        sessionId?: string;
        message?: string;
      };
      if (event.type === 'server.session.ready') {
        sessionId = event.sessionId ?? '';
        resolve();
      } else if (event.type === 'server.transcript.final') {
        transcriptAt ||= Date.now();
      } else if (event.type === 'server.audio.frame') {
        firstAudioAt ||= Date.now();
      } else if (event.type === 'server.error') {
        failure = event.message ?? 'server error';
      }
    };
  });

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    setTimeout(() => reject(new Error(`no connection to ${WS_URL}`)), 5000);
  });
  // Carries the ids a real client sends. The server tolerates their absence, so
  // omitting them here would measure a path production never takes.
  const turnId = crypto.randomUUID();
  send({ type: 'client.session.start', direction: 'vi_to_en', turnId });
  await ready;

  for (const step of steps) {
    if (step.kind === 'audio') {
      send({
        type: 'client.audio.frame',
        frame: {
          sessionId,
          encoding: 'pcm16',
          sampleRate: TARGET_SAMPLE_RATE,
          sequence: sequence++,
          timestamp: Date.now(),
          payload: pcm16ToBase64(step.block),
        },
      });
      await wait(BLOCK_MS);
    } else if (step.kind === 'speculate') {
      send({ type: 'client.turn.speculate', sessionId });
      // The speaker is still silent here; the server gets this long to work
      // before the endpoint is confirmed. Skipping the wait would hand it none.
      await wait(REMAINING_HANGOVER_MS);
    } else {
      endpointAt = Date.now();
      send({ type: 'client.session.end', sessionId });
    }
  }

  const deadline = Date.now() + 30000;
  while (!firstAudioAt && !failure && Date.now() < deadline) await wait(25);
  socket.close();

  return {
    id,
    firstAudioMs: firstAudioAt ? firstAudioAt - endpointAt : Number.NaN,
    transcriptMs: transcriptAt ? transcriptAt - endpointAt : Number.NaN,
    error: failure || (firstAudioAt ? undefined : 'timed out'),
  };
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

const manifestPath = join(FIXTURES, 'manifest.json');
const enabled = !!process.env.MEASURE_PIPELINE && existsSync(manifestPath);

describe.skipIf(!enabled)('pipeline latency over real speech', () => {
  it('reports endpoint to first audio', async () => {
    const turns: Turn[] = JSON.parse(readFileSync(manifestPath, 'utf8')) as Turn[];

    const scripts = new Map(
      turns.map((turn) => [turn.id, scriptFor(readWavAsFloat(join(FIXTURES, turn.file)))]),
    );

    // Warm-up, discarded. The first turns through a cold stack measured 26s,
    // 24s and 12s before settling near 1s — TLS to the translation API, the
    // first inference through each ONNX session, and the JIT all land on
    // whoever goes first. Folding that into a p50 would describe a machine
    // that had just started rather than one in use. It is still worth knowing
    // it happens: the first turn of a live demo pays it too.
    const warmUpCount = Number(process.env.MEASURE_WARMUP ?? 3);
    const warmUp: Measured[] = [];
    for (const turn of turns.slice(0, warmUpCount)) {
      warmUp.push(await measureTurn(turn.id, scripts.get(turn.id)!));
    }

    const results: Measured[] = [];
    for (const turn of turns) {
      // Sequential on purpose: two turns at once would queue on the sidecar's
      // per-engine lock and report contention as latency.
      results.push(await measureTurn(turn.id, scripts.get(turn.id)!));
    }

    const ok = results.filter((r) => Number.isFinite(r.firstAudioMs));
    const rows = results.map(
      (r) =>
        `  ${r.id.padEnd(10)} ` +
        (r.error
          ? `FAILED ${r.error}`
          : `transcript=${String(r.transcriptMs).padStart(5)}ms  first-audio=${String(r.firstAudioMs).padStart(5)}ms`),
    );

    const warmOk = warmUp.filter((r) => Number.isFinite(r.firstAudioMs));
    const firstAudio = ok.map((r) => r.firstAudioMs);
    const transcript = ok.map((r) => r.transcriptMs);

    console.log(
      [
        '',
        `Discarded warm-up: ${warmUp.length} turns` +
          (warmOk.length
            ? ` (first audio ${warmOk.map((r) => `${r.firstAudioMs}ms`).join(', ')})`
            : ''),
        `Turns measured: ${ok.length}/${results.length}`,
        '',
        ok.length
          ? [
              `Endpoint → transcript:  p50 ${percentile(transcript, 0.5)}ms  p95 ${percentile(transcript, 0.95)}ms`,
              `Endpoint → first audio: p50 ${percentile(firstAudio, 0.5)}ms  p95 ${percentile(firstAudio, 0.95)}ms`,
            ].join('\n')
          : 'No turn completed.',
        '',
        ...rows,
        '',
        'Reuse rate and per-stage timings: JSONL at TURN_METRICS_PATH and the API log.',
        '',
      ].join('\n'),
    );

    expect(results.length).toBeGreaterThan(0);
  }, 600000);
});
