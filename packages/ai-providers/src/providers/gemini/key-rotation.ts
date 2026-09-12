// Which (key, model) pairs are worth trying, and which are known to be spent.
//
// The free tier meters requests per PROJECT per MODEL, both per minute and per
// day, so the pool is a matrix rather than a list. This owns the whole of that
// bookkeeping — the cooldowns, the retirements, and the rotation cursor — so the
// provider is left deciding only what to do about a failure, not remembering it.
import { GoogleGenAI } from '@google/genai';

/**
 * Deadline for one Gemini request, in milliseconds.
 *
 * Sized against the measured tail, not against a target: translation is p50
 * 723ms and p95 1947ms, but the worst observed call took 8943ms. A cap below
 * that would cut calls that were going to succeed, which costs the speaker a
 * turn — worse than the delay it saves.
 *
 * It exists because translation is the longest stage on the turn path and had
 * no deadline at all. A hung call holds one of the API's six global turn slots,
 * and the idle sweep deliberately skips translating turns, so one wedged
 * request removed that slot for the life of the process; with the slots gone
 * every client is refused `too_many_turns`, and the web client responds by
 * discarding the audio it was holding. Rotation already retries across keys and
 * models, so giving up on one attempt is cheap.
 */
const GEMINI_TIMEOUT_MS = 20_000;

/**
 * The keys to rotate across, in configuration order.
 *
 * A single comma-separated string rather than a list because the only thing
 * that configures this is an environment variable, which cannot hold a list.
 * A Gemini key never contains a comma, so the separator is unambiguous.
 *
 * Trimming and de-duplication happen here rather than at the call site because
 * this is the boundary that owns the invariant: a duplicated key is a second
 * draw on a bucket the pool already counted, which silently overstates the
 * headroom the rotation believes it has.
 */
export function resolveApiKeys(apiKey: string | undefined): string[] {
  return [
    ...new Set(
      (apiKey ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Cooldown map key for one quota bucket.
 *
 * The key INDEX, never the key itself — this string reaches error messages and
 * logs, and key material must not.
 */
function pairKey(keyIndex: number, model: string): string {
  return `${keyIndex}:${model}`;
}

/** One live key and the client bound to it. */
export interface KeySlot {
  index: number;
  client: GoogleGenAI;
}

export class KeyRotation {
  /**
   * One client per key, all built in the constructor so every keep-alive
   * connection pool stays warm — a client built per turn would pay a fresh TLS
   * handshake on the latency-critical path.
   */
  private readonly clients: readonly GoogleGenAI[];
  /**
   * Epoch ms before which a (key, model) pair is known to be rate limited,
   * under {@link pairKey}.
   *
   * Keyed on the pair, not the model: quota is metered per project per model,
   * and one key ≈ one project. What the API said about a model under one key
   * is therefore no statement at all about the same model under another —
   * treating it as one would drop the whole pool onto the slow reserve the
   * moment a single key ran dry.
   */
  private readonly cooldownUntil = new Map<string, number>();
  /**
   * Key indices the API rejected outright. A rejected key never heals, so it
   * is retired for the process lifetime instead of retried every turn.
   */
  private readonly retired = new Set<number>();
  /** Rotation cursor — where the next turn starts its walk across the keys. */
  private nextKey = 0;

  constructor(apiKeys: readonly string[]) {
    this.clients = apiKeys.map(
      (apiKey) => new GoogleGenAI({ apiKey, httpOptions: { timeout: GEMINI_TIMEOUT_MS } }),
    );
  }

  get size(): number {
    return this.clients.length;
  }

  /** Whether every configured key has been rejected — a configuration fault. */
  get allRetired(): boolean {
    return this.retired.size >= this.clients.length;
  }

  isRetired(index: number): boolean {
    return this.retired.has(index);
  }

  /** The credential is bad, whatever it is asked for. Permanent. */
  retire(index: number): void {
    this.retired.add(index);
  }

  /** Whether this pair is still inside a cooldown and must not be probed. */
  isCoolingDown(index: number, model: string, now = Date.now()): boolean {
    return (this.cooldownUntil.get(pairKey(index, model)) ?? 0) > now;
  }

  /**
   * Hold a (key, model) pair out for at least `ms`.
   *
   * Never shortens an existing cooldown. A blind write would let a ten-second
   * overload erase an hour-long daily exhaustion recorded moments earlier,
   * which puts the pool straight back to re-probing a bucket already known to
   * be empty — the exact cost the long cooldowns exist to avoid.
   */
  cool(keyIndex: number, model: string, ms: number): void {
    const key = pairKey(keyIndex, model);
    const until = Date.now() + ms;
    this.cooldownUntil.set(key, Math.max(this.cooldownUntil.get(key) ?? 0, until));
  }

  /** Cool every live key on one model — a server-side capacity wall. */
  coolAll(model: string, ms: number): void {
    for (const { index } of this.liveKeys()) this.cool(index, model, ms);
  }

  /**
   * The live keys to try this turn, rotated so consecutive turns open on
   * different projects.
   *
   * Round-robin rather than sticky-until-throttled: staying on one key until
   * it 429s guarantees a wasted round-trip every time it crosses its
   * per-minute ceiling, and that happens precisely during a burst, when
   * latency is least affordable. Spreading turns keeps the aggregate below
   * every individual ceiling, so with N healthy keys the first 429 arrives
   * roughly N times later — or never.
   */
  order(): KeySlot[] {
    const live = this.liveKeys();
    if (!live.length) return live;

    // The cursor walks the LIVE keys, not every slot. Advancing it over
    // retired indices would make the key following a retired one open twice as
    // many turns as its neighbours, and that key then reaches its per-minute
    // ceiling twice as fast — which is precisely the imbalance rotation is
    // here to prevent.
    const start = this.nextKey % live.length;
    this.nextKey = (start + 1) % live.length;

    return [...live.slice(start), ...live.slice(0, start)];
  }

  /**
   * When the soonest pair across this ladder leaves its cooldown, in seconds.
   *
   * For the message said when nothing was even tried. Key indices, never key
   * material, inform this number.
   */
  soonestRecoverySeconds(ladder: readonly string[], keys: readonly { index: number }[]): number {
    const soonest = Math.min(
      ...ladder.flatMap((model) =>
        keys.map(({ index }) => this.cooldownUntil.get(pairKey(index, model)) ?? 0),
      ),
    );
    return Math.max(0, Math.ceil((soonest - Date.now()) / 1000));
  }

  private liveKeys(): KeySlot[] {
    return this.clients
      .map((client, index) => ({ index, client }))
      .filter(({ index }) => !this.retired.has(index));
  }
}
