/** What a respelling is asked about. */
export interface LoanwordRespellRequest {
  /** The recognizer's transcript, as it reached the translator. */
  transcript: string;
  /** The transcript's spans that cannot be words of its language. */
  spans: string[];
  /**
   * The finished translation of the same transcript.
   *
   * Required rather than optional because it was measured as load-bearing: on
   * the 50 Vietnamese turns in production on 2026-10-07, the same model given
   * the translation got 9 of the garbled spans right and without it 7, inventing
   * "Joseph Pengo" where the translation said "Joshua Bengio".
   */
  translation: string;
  /**
   * Whether {@link translation} is written in Han characters.
   *
   * Such a translation cannot attest a Latin spelling letter for letter, so the
   * model is asked to point at where the translation renders each span as well,
   * and answers with a {@link RenderedSpelling}.
   */
  translationInHan?: boolean;
}

/** A spelling, with the words of a Han translation that render the same span. */
export interface RenderedSpelling {
  spelling: string;
  rendering: string;
}

/**
 * One span's proposal: a spelling, a spelling with its rendering in a Han
 * translation, or null for "already right, or cannot tell".
 */
export type LoanwordProposal = string | RenderedSpelling | null;

/** What a homophone repair is asked about. */
export interface HomophoneRepairRequest {
  /** The recognizer's Vietnamese transcript. */
  transcript: string;
  /** The finished transcripts spoken just before it, oldest first. */
  before: readonly string[];
}

/** What a recognizer fusion is asked about. */
export interface RecognizerFusionRequest {
  /** The production recognizer's Vietnamese transcript. */
  transcript: string;
  /** The same audio as other recognizers heard it; the first is asked about. */
  alternates: readonly string[];
  /** The finished transcripts spoken just before it, oldest first. */
  before: readonly string[];
}

/**
 * The model checks of a recognizer's transcript, on the translation host.
 *
 * Three questions, one host: how a garbled foreign word was most likely
 * spelled ({@link respell}), which Vietnamese words were misheard as a word
 * that sounds the same ({@link repairHomophones}), and which of two
 * recognizers heard each stretch right ({@link fuseRecognizers}).
 *
 * Every answer is a PROPOSAL: the caller decides whether a reader ever sees it,
 * and must check it deterministically first — this is a model writing into the
 * speaker's own line, the surface that once had its model removed for exactly
 * that reason. The checks are `acceptRespellings`, `acceptHomophoneRepairs` and
 * `acceptRecognizerFusion`.
 */
export interface LoanwordRespeller {
  readonly name: string;
  /** Proposals keyed by span, keeping only the spans asked. */
  respell(request: LoanwordRespellRequest): Promise<Record<string, LoanwordProposal>>;
  /**
   * Proposed `{heard, said}` pairs, unchecked: whatever the model answered in
   * its list, for `acceptHomophoneRepairs` to judge.
   */
  repairHomophones(request: HomophoneRepairRequest): Promise<unknown[]>;
  /**
   * The words the model judges were said, picked between the transcript and
   * an alternate, unchecked: whatever it answered as `text`, for
   * `acceptRecognizerFusion` to judge.
   */
  fuseRecognizers(request: RecognizerFusionRequest): Promise<unknown>;
}
