import { MAX_TURN_BYTES } from './turn-audio';

/**
 * How many turns may be in flight at once, and why each number is what it is.
 *
 * Kept apart from `translation-model-policy.ts`, which is about which models a
 * turn may spend. These are not quota decisions: they bound memory and CPU on
 * this machine, and they are answered by the sidecars' throughput rather than by
 * anyone's per-minute ceiling. Both files follow the same rule — the reasoning
 * travels with the constant.
 *
 * Both numbers are provisional. They are set from the constraint rather than from
 * measurement, and the RTF figures in phase 8 of the continuous-capture plan are
 * what will settle them.
 */

/**
 * Turns one socket may hold open at once.
 *
 * This is a fairness ceiling, not a resource one: it stops a single client from
 * taking the whole machine, and says nothing about what the machine can bear.
 *
 * Three is what continuous capture needs. At an ~8s forced cut and a p95 turn
 * latency near 2s, a speaker who never pauses has at most two turns in the
 * pipeline with one opening behind them.
 */
export const MAX_CONCURRENT_TURNS_PER_SOCKET = 3;

/**
 * Turns open across the whole process.
 *
 * This is the ceiling that actually guards the machine, and it has to exist
 * alongside the per-socket one rather than instead of it. The STT and TTS
 * sidecars are one shared process each (`LOCAL_STT_URL`, `LOCAL_TTS_URL`), so a
 * limit divided per socket cannot see the load: two sockets at three turns apiece
 * is six concurrent inferences without either socket touching its own ceiling.
 * `/ws/translate` does require a bearer token at upgrade (`ws-auth.ts`) — an
 * earlier version of this comment said otherwise — but authentication bounds WHO
 * opens sockets, not how many, so the ceiling is still the only thing that does.
 *
 * Six is two full-rate speakers. Past that the sidecars oversubscribe the CPU and
 * every turn in flight gets slower together, which in a conversation means all of
 * them arrive too late rather than most of them arriving on time.
 */
export const MAX_CONCURRENT_TURNS_GLOBAL = 6;

/**
 * How long a turn may sit without a frame before the server closes it.
 *
 * The global ceiling above needs this to mean anything. Without it a turn lives until
 * `client.session.end` or a socket disconnect, so two sockets can send
 * six `client.session.start` messages, send nothing further, and hold
 * {@link MAX_CONCURRENT_TURNS_GLOBAL} for as long as they stay connected — every other
 * client then gets `too_many_turns` on every start. A per-socket ceiling alone was only
 * ever a self-inflicted wound; a global one turns the same stuck turn into a denial of
 * service for everyone, so introducing it obliges this.
 *
 * 30s is far longer than any gap inside speech — a client that is still there sends a
 * frame every ~20ms while someone talks, and closes the turn when they stop.
 *
 * Only turns still LISTENING are swept. One that is translating is doing work with a
 * measured tail of up to ~9s, and its own `end()` closes it; cutting that off would
 * discard an answer the listener is waiting for.
 */
export const TURN_IDLE_TIMEOUT_MS = 30_000;

/**
 * How often idle turns are looked for.
 *
 * One sweep for the whole process rather than a timer per turn: a timer per turn is
 * one more thing to cancel on every close path, and forgetting one there is a leak that
 * only shows up under load.
 */
export const TURN_IDLE_SWEEP_MS = 10_000;

/**
 * Turns remembered as having already filed a client metrics row.
 *
 * A client sends one row per turn, so a second is either a bug or an attempt to make
 * this endpoint write to disk in a loop. Bounded because the set is process-wide.
 */
export const MAX_REMEMBERED_METRICS_ROWS = 512;

/**
 * Worst-case inbound audio one socket can pin in memory.
 *
 * Exists to make the coupling impossible to miss: raising the per-socket turn
 * ceiling raises this by the same factor, because every open turn buffers its own
 * audio up to `MAX_TURN_BYTES`. Real-time-factor measurements answer how many
 * turns the CPU can decode at once and say nothing whatsoever about memory, so
 * anyone tuning the ceiling from RTF alone has to be shown the other half.
 *
 * At the current numbers: 5.76 MB per turn, 17.28 MB per socket, 34.56 MB across
 * the global ceiling.
 */
export const MAX_BUFFERED_BYTES_PER_SOCKET =
  MAX_TURN_BYTES * MAX_CONCURRENT_TURNS_PER_SOCKET;
