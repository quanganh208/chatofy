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
 * is six concurrent inferences without either socket touching its own ceiling,
 * and because `/ws/translate` takes no authentication, nothing bounds how many
 * sockets there are.
 *
 * Six is two full-rate speakers. Past that the sidecars oversubscribe the CPU and
 * every turn in flight gets slower together, which in a conversation means all of
 * them arrive too late rather than most of them arriving on time.
 */
export const MAX_CONCURRENT_TURNS_GLOBAL = 6;

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
