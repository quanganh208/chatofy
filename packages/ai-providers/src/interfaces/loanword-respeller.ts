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
}

/**
 * How a recognizer's garbled foreign words were most likely spelled.
 *
 * The answer is keyed by span, and a null means the span is already right or
 * cannot be told. It is a PROPOSAL: the caller decides whether a reader ever
 * sees it, and must check it deterministically first — this is a model writing
 * into the speaker's own line, the surface that once had its model removed for
 * exactly that reason.
 */
export interface LoanwordRespeller {
  readonly name: string;
  respell(request: LoanwordRespellRequest): Promise<Record<string, string | null>>;
}
