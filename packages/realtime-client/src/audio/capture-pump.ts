import { SpeechGate, type SpeechEndReason } from './speech-gate.js';
import { pcm16Rms, TARGET_SAMPLE_RATE } from './pcm-resampler.js';

/**
 * Decides what happens to every captured block: whether it opens a turn, feeds
 * one, or is thrown away.
 *
 * Split out of the React hook deliberately. This is the whole turn-taking
 * policy, it is pure apart from the callbacks, and it is where a mistake is
 * invisible — an earlier revision closed the microphone on speech *start*
 * instead of speech *end*, so every turn sent one block and then hung forever.
 * Typecheck, lint and build all passed. Only a test of this ordering catches it,
 * which is why the ordering lives somewhere a test can reach.
 */

/**
 * Audio kept from just before speech is confirmed.
 *
 * The gate needs a moment of sound before it will call something an utterance;
 * without this the first syllable of every turn would already be gone by then.
 */
const PRE_ROLL_MS = 320;

/**
 * Why a turn ended, as the pump reports it.
 *
 * Wider than {@link SpeechEndReason} because not every ending comes from the
 * gate: `interrupted` is the pump's own, raised when our translation starts
 * sounding while someone is still mid-utterance and half duplex therefore stops
 * honouring the microphone.
 *
 * Deliberately NOT folded into `forced`. That one means "hit the length
 * ceiling", it is what sets `cutForced` on the metrics row, and the turn-length
 * histogram reads `cutForced` as its right-censoring signal — so reusing it here
 * would report playback interruptions as ceiling cuts and quietly bias a
 * measurement a later phase depends on.
 */
export type TurnCloseReason = SpeechEndReason | 'interrupted';

/** Where the pump is in the turn cycle. */
export type CaptureState =
  /** Listening for someone to start talking. */
  | 'idle'
  /** Someone is talking; their audio is being forwarded. */
  | 'in-turn'
  /**
   * They stopped, and the caller has not said the turn is finished — which
   * means its translation has been spoken, not merely received.
   *
   * One of the two halves of the half-duplex window (the other is
   * {@link CapturePumpOptions.sounding}); two people sharing one phone otherwise
   * get a loop where the loudspeaker feeds the microphone and the app translates
   * itself forever. Continuous mode never enters this state, which is why the
   * window cannot be defined by it alone.
   */
  | 'awaiting-result';

export interface CapturePumpHandlers {
  /**
   * Speech confirmed. `preRoll` is the audio captured just before, in order,
   * and belongs at the start of the turn.
   */
  onTurnOpen: (preRoll: Int16Array[]) => void;
  /** A block belonging to the open turn. */
  onAudio: (block: Int16Array) => void;
  /** Silence long enough to suspect the turn is over, but not to declare it. */
  onProbableEnd: () => void;
  /**
   * The turn is over. `reason` distinguishes a speaker who stopped from one who
   * was cut at the length ceiling while still talking.
   *
   * The caller needs the difference: a cut turn ends mid-sentence, so its
   * translation is missing context the next turn carries, and the metrics row for
   * it has to say which kind of turn it was rather than leaving a quality drop
   * looking like a pipeline fault.
   */
  onTurnClose: (reason: TurnCloseReason) => void;
  /** Microphone level for a meter, 0 while the microphone is ignored. */
  onLevel: (level: number) => void;
  /**
   * The microphone heard speech while our own translation was playing.
   *
   * That is ALL it means, and what it is evidence of depends on the mode:
   *
   * - Half duplex — the microphone is ignored throughout the window, so a person
   *   talking is not what confirmed this gate. What is left is our loudspeaker
   *   coming back, and the count is an echo measurement. Reported rather than
   *   acted on, because without it the absence of a self-triggered turn would
   *   look like proof that echo cancellation works when it only proves the
   *   microphone was off.
   * - Full duplex — the microphone IS honoured, so someone talking over the
   *   playback fires this too, and that is the feature working rather than a
   *   fault. The count is then "speech during playback": echo, barge-in and room
   *   noise together, and nothing here can separate them. A caller that shows it
   *   must not label it echo — see `apps/web`'s meter — and a device check has to
   *   say "do not talk over the playback" for the number to mean anything.
   *
   * "While our own translation was playing" used to mean `awaiting-result`,
   * which continuous mode never enters — so this could not be measured at all in
   * the configuration that needs it most. It now also fires on
   * {@link CapturePumpOptions.sounding}.
   */
  onEchoHeard?: () => void;
  /**
   * Whether the microphone is being ignored right now, on each change.
   *
   * Only the pump knows this once the window stopped being a state: in
   * continuous mode nothing closes a turn into `awaiting-result`, so a caller
   * watching turn transitions sees nothing while blocks are being dropped. An
   * indicator built on anything else says "listening" while speech is going in
   * the bin — the single worst thing this UI can claim.
   */
  onMuted?: (muted: boolean) => void;
}

export interface CapturePumpOptions {
  /**
   * Keep listening while our own translation plays.
   *
   * Off by default and meant to stay that way for a shared phone, where the
   * loudspeaker feeds the microphone and the app translates itself in a loop. It
   * is safe when capture and playback are structurally separate — a browser
   * extension capturing a tab and playing through an offscreen document — because
   * the digital path back does not exist. See
   * {@link CapturePumpHandlers.onEchoHeard} for the acoustic path, which remains.
   *
   * This is the ONLY switch that decides whether the microphone is honoured while
   * our own audio is out. It used to share that job with {@link continuous},
   * which meant a caller could turn listening-through-playback on without asking
   * for it — and did: `continuous` alone reached neither the mute nor the echo
   * count, because both hung off `awaiting-result`, a state continuous mode never
   * enters.
   */
  fullDuplex?: boolean;
  /**
   * End a turn by returning to `idle` rather than waiting to be re-armed.
   *
   * Turn cycling ONLY. It no longer implies anything about the microphone being
   * honoured through playback — that is {@link fullDuplex} — nor about whether
   * echo is counted, which now always happens.
   *
   * `armNextTurn()` is the only place that sets `idle`, and it is called once a
   * turn has both ended server-side and finished playing. That is right when one
   * turn exists at a time. With turns running concurrently nobody calls it, and
   * without this flag a turn that ends the ordinary way — on silence, which
   * happens between every two sentences in a real meeting — would leave the pump
   * in `awaiting-result` for good: blocks would match neither the `in-turn` nor
   * the `idle` branch and be dropped, so the next turn would open with an empty
   * pre-roll and lose its first ~440ms, and `isMuted` would read true for the
   * rest of the conversation.
   */
  continuous?: boolean;
  /** Longest a turn may run before it is cut. 0, the default, never cuts. */
  maxUtteranceMs?: number;
  /** How far before the ceiling to start looking for a quiet block. */
  cutLookaheadMs?: number;
  /**
   * Whether our own translated audio is sounding RIGHT NOW.
   *
   * The only interval during which the loudspeaker can reach the microphone, and
   * therefore the only thing both the echo count and the half-duplex mute should
   * key on outside the single-turn wait.
   *
   * A predicate rather than a pushed flag, so it is evaluated at the instant a
   * block is classified rather than at some earlier transition, and so nothing
   * here has to be kept in sync.
   *
   * MUST NOT be wired to `OrderedPlayback.isBusy` — the signal
   * `onPlaybackBusy` carries. `isBusy` is `queue.isPlaying || turns.size > 0`,
   * and a turn enters that map when it OPENS, which is when someone starts
   * talking. Keyed on that, a gate holds the microphone shut for as long as any
   * turn is in flight — with several turns in flight, effectively forever — and
   * it passes every test in a quiet room. `apps/extension/src/sounding-sink.ts`
   * documents the same trap, reached independently. Ducking keeps using
   * `isBusy`, deliberately: that one wants "queued or playing", this one wants
   * "audible now".
   *
   * Defaults to never sounding, which keeps a caller that does not pass it — and
   * every existing test — on exactly the behaviour they had.
   */
  sounding?: () => boolean;
}

export class CapturePump {
  private readonly gate: SpeechGate;
  private state: CaptureState = 'idle';
  /** Rolling recent audio, so a turn does not start mid-word. */
  private preRoll: Int16Array[] = [];
  private readonly preRollBlocks: number;
  /**
   * Silence heard mid-turn, kept back rather than sent.
   *
   * The server decides whether the text it worked out early is still valid by
   * checking that its byte count has not moved since. Streaming the silence
   * that follows an utterance moves that count for audio carrying nothing, so
   * the check could never pass and the early work was always thrown away.
   *
   * Held instead: flushed intact the moment speech resumes, dropped when the
   * turn ends — at which point it is by definition nothing but silence.
   *
   * Bounded by the gate: it is emptied on speech and on end of turn, so it
   * never holds more than one hangover's worth.
   */
  private held: Int16Array[] = [];

  /**
   * Hears what the microphone picks up while our own audio plays, so the echo
   * can be counted without acting on it.
   */
  private readonly echoGate: SpeechGate;

  private readonly fullDuplex: boolean;
  private readonly continuous: boolean;
  private readonly sounding: () => boolean;
  /**
   * Whether the meter has already been told the microphone is being ignored.
   *
   * An edge, not a level: the single-turn path zeroes the meter once in
   * {@link closeTurn} and then says nothing for the rest of the muted window,
   * and that silence is asserted. Reporting every ignored block would break it.
   * Continuous mode has no such close, so the edge is what stops its meter
   * freezing at whatever it last read when playback starts.
   */
  private levelZeroed = false;
  /**
   * Blocks thrown away because our own audio was sounding.
   *
   * Counted rather than inferred, because this is speech the speaker made and
   * the system silently discarded — in half duplex there is no other trace of
   * it. Cumulative for the run: a per-turn reset would hide exactly the case
   * worth seeing, which is a conversation where it keeps happening.
   *
   * Gated on {@link sounding} alone, NOT on the whole mute window. The
   * single-turn path is muted from the moment the speaker stops, which is up to
   * ~900ms before the first sample exists; counting those blocks here would put
   * a number under the name "while sounding" that is mostly the silent wait for
   * the translation to arrive.
   */
  private droppedWhileSounding = 0;
  /** Whether the previous block fell inside a window where our audio could be heard. */
  private echoWindowOpen = false;
  /** Last value handed to {@link CapturePumpHandlers.onMuted}, so it reports edges only. */
  private mutedReported = false;

  constructor(
    private readonly handlers: CapturePumpHandlers,
    /** Samples per block, needed to size the pre-roll and time the gate. */
    blockSamples: number,
    // An options bag rather than trailing positionals: `fullDuplex` and
    // `continuous` are both booleans and both about listening through playback,
    // so adjacent positional flags would be trivial to transpose at a call site
    // and impossible to spot when read back.
    options: CapturePumpOptions = {},
  ) {
    this.fullDuplex = options.fullDuplex ?? false;
    this.continuous = options.continuous ?? false;
    this.sounding = options.sounding ?? (() => false);

    const blockMs = (blockSamples / TARGET_SAMPLE_RATE) * 1000;
    this.preRollBlocks = Math.max(1, Math.round(PRE_ROLL_MS / blockMs));
    this.gate = new SpeechGate(
      {
        onSpeechStart: () => {
          this.state = 'in-turn';
          const preRoll = this.preRoll;
          this.preRoll = [];
          this.handlers.onTurnOpen(preRoll);
        },
        onProbableEnd: () => {
          // Release the tail before letting the server take its snapshot, so the
          // recogniser still hears the end of the last word.
          //
          // Holding silence keeps the byte count still, which is what makes the
          // early work reusable — but a word does not end where the level drops
          // below the gate's threshold. Final unvoiced consonants sit well under
          // the vowel before them, and discarding everything quiet would clip
          // them off every utterance. Flushing here puts them inside the
          // snapshot; only the silence that follows it stays held, and that is
          // silence the recogniser has no use for.
          this.flushHeld();
          this.handlers.onProbableEnd();
        },
        onSpeechEnd: (reason) => this.closeTurn(reason),
      },
      {
        maxUtteranceMs: options.maxUtteranceMs,
        cutLookaheadMs: options.cutLookaheadMs,
      },
    );

    // Deliberately built WITHOUT the length ceiling. This gate only counts how
    // much of our own audio comes back, and a ceiling would make it fire on the
    // clock instead of on echo — destroying the one measurement that says whether
    // listening through playback works at all.
    this.echoGate = new SpeechGate({
      onSpeechStart: () => this.handlers.onEchoHeard?.(),
    });
  }

  /**
   * The turn is over. Drop what is held and close it.
   *
   * Nothing is flushed here, and that is worth stating because the opposite looks
   * necessary. A forced cut lands while the speaker is still going, so held audio
   * would belong to the turn being closed rather than to the silence that ended
   * it — except that a cut cannot be reached while anything is held. Arming fires
   * `onProbableEnd`, which flushes; and the cut can only happen at or after the
   * arm. So by the time this runs, `held` is either empty or pure trailing
   * silence, and dropping it is right in both cases.
   *
   * A flush here was written first and then removed: no test could distinguish it
   * from a no-op, because there is no sequence that reaches it with audio held.
   */
  private closeTurn(reason: TurnCloseReason): void {
    // Stop listening here, not at speech start: everything between those two
    // points is the utterance being translated. In continuous mode there is
    // nothing to wait for and nobody to re-arm us, so the pump goes straight back
    // to listening for the next turn.
    this.state = this.continuous ? 'idle' : 'awaiting-result';
    this.preRoll = [];
    this.held = [];
    // Only meaningful when the microphone is about to be ignored. In continuous
    // mode it stays open, and zeroing the meter would report a mute that is not
    // happening — there, the meter is zeroed instead when playback actually
    // starts sounding, on the edge tracked by `levelZeroed`.
    if (!this.continuous) {
      this.levelZeroed = true;
      this.handlers.onLevel(0);
    }
    this.handlers.onTurnClose(reason);
  }

  /**
   * Whether our own audio could be reaching the microphone right now.
   *
   * Two conditions, because there are two ways to be in that window and neither
   * covers the other. `awaiting-result` is the single-turn wait, which begins
   * before a single sample has been synthesized and so covers the gap the
   * loudspeaker has not reached yet. {@link CapturePumpOptions.sounding} is the
   * narrower fact — audio is audible now — and it is the only one of the two
   * that continuous mode ever sees, because it never enters `awaiting-result`.
   *
   * This is the whole separation this class was reorganised for: turn cycling
   * (`continuous`) no longer decides either of the two things below.
   */
  private get selfAudioPossible(): boolean {
    return this.state === 'awaiting-result' || this.sounding();
  }

  /** True while the microphone is deliberately ignored. */
  get isMuted(): boolean {
    return !this.fullDuplex && this.selfAudioPossible;
  }

  /** How many captured blocks were discarded because our own audio was out. */
  get droppedBlocksWhileSounding(): number {
    return this.droppedWhileSounding;
  }

  /** Feed one block of 16 kHz mono PCM16 from the microphone. */
  push(block: Int16Array): void {
    const blockMs = (block.length / TARGET_SAMPLE_RATE) * 1000;

    const rms = pcm16Rms(block);

    // Our own audio just stopped. The echo gate is fed ONLY inside these
    // windows, so without a reset here its idea of "an utterance" spans the gap
    // between two of them: it ends the first window still `speaking`, never
    // hears the silence that would end that utterance, and so never fires
    // `onSpeechStart` again. Measured before this line: four separate playback
    // windows, each with unmistakable echo, reported a total of ONE.
    //
    // That is not a cosmetic undercount. The clearance gate this measurement
    // feeds passes at 0/20 turns, so a device that echoes on every single turn
    // would have reported 1 and read as very nearly clean — the number failing
    // toward "switch full duplex on". `armNextTurn()` used to do this reset, but
    // it is only ever called on the single-turn path.
    const selfAudio = this.selfAudioPossible;
    if (!selfAudio && this.echoWindowOpen) this.echoGate.reset();
    this.echoWindowOpen = selfAudio;

    // Reported on the edge, before the branch below returns: this is the only
    // place that knows the microphone stopped being listened to.
    const ignoring = !this.fullDuplex && selfAudio;
    if (ignoring !== this.mutedReported) {
      this.mutedReported = ignoring;
      this.handlers.onMuted?.(ignoring);
    }

    if (selfAudio) {
      // Our own translation is playing, so whatever comes back is the room and
      // the loudspeaker. Counted on a gate of its own regardless of mode: how
      // much of our own audio returns is the number that decides whether
      // listening through playback is possible at all, and a microphone that is
      // switched off cannot measure it.
      this.echoGate.push(rms, blockMs);
      if (!this.fullDuplex) {
        // Playback started while someone was still talking, and half duplex has
        // just stopped honouring the microphone mid-utterance.
        //
        // The turn has to be CLOSED here, not merely abandoned. `gate.reset()`
        // below emits nothing by design, so without this the turn is left open
        // with capture silently detached from it: when speech resumes the gate
        // re-confirms, `onTurnOpen` mints a NEW turn, and the old one is never
        // ended — it holds an in-flight slot until the stall watchdog and its
        // audio is never translated. That could not happen while this branch
        // was reachable only from `awaiting-result`, which is mutually
        // exclusive with `in-turn`; keying it on live playback is what made it
        // reachable, and continuous half-duplex capture produces it constantly.
        if (this.state === 'in-turn') this.closeTurn('interrupted');
        // Only what was dropped with our audio actually out — see the field.
        if (this.sounding()) this.droppedWhileSounding += 1;
        // Once per window, not per block — see `levelZeroed`.
        if (!this.levelZeroed) {
          this.levelZeroed = true;
          this.handlers.onLevel(0);
        }
        this.gate.reset();
        return;
      }
    }
    this.levelZeroed = false;

    this.handlers.onLevel(rms);
    // May flip the state through onSpeechStart / onSpeechEnd.
    const isSpeech = this.gate.push(rms, blockMs);

    if (this.state === 'in-turn') {
      if (!isSpeech) {
        // Might be a pause inside the utterance, might be its end. Hold it
        // until the gate decides which, so the server's byte count stays put.
        this.held.push(block);
        return;
      }
      // Speech resumed, so the pause was internal after all: the held audio is
      // part of the utterance and goes first, in order.
      this.flushHeld();
      this.handlers.onAudio(block);
      return;
    }

    if (this.state === 'idle') {
      this.preRoll.push(block);
      if (this.preRoll.length > this.preRollBlocks) this.preRoll.shift();
    }
  }

  /**
   * Start listening again. The caller must only do this once the finished turn
   * has both ended server-side AND played out — releasing on either alone
   * reopens the microphone into our own audio.
   */
  armNextTurn(): void {
    this.state = 'idle';
    this.preRoll = [];
    this.held = [];
    this.levelZeroed = false;
    this.echoWindowOpen = false;
    this.gate.reset();
    this.echoGate.reset();
  }

  /** Forget everything, e.g. when the conversation is torn down. */
  reset(): void {
    this.armNextTurn();
  }

  /**
   * Send everything held back, oldest first, and stop holding it.
   *
   * Emptied before the first callback rather than after the last: if a handler
   * throws part-way, the blocks already sent are gone from the queue and a
   * later flush cannot send them a second time. Duplicated audio corrupts the
   * utterance, where a dropped block only shortens it.
   */
  private flushHeld(): void {
    if (!this.held.length) return;
    const pending = this.held;
    this.held = [];
    for (const block of pending) this.handlers.onAudio(block);
  }
}
