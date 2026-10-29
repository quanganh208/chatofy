// One translation provider over two hosts: the primary first, the secondary on
// any failure of it.
//
// Every failure, not only the retryable ones, because the two sides are
// different hosts serving different models: a request one of them refuses —
// a rejected key, a model missing from a plan, a 400 over a vendor field — is
// no evidence the other will. The only error a caller sees is the secondary's.
//
// The sequence is strictly one then the other, so there is nothing to abort:
// the primary has already settled when the secondary starts, and its own
// deadlines bound how long that takes.
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../../interfaces/translation-provider.js';
import { type HostCircuit, tripOnPersistentFailure } from './host-circuit.js';

export interface FailoverTranslationProviderConfig {
  /** The registry name, which is also what a log line names. */
  name: string;
  primary: TranslationProvider;
  secondary: TranslationProvider;
  /** Shared with every other caller of the primary's host. */
  circuit: HostCircuit;
}

export class FailoverTranslationProvider implements TranslationProvider {
  readonly name: string;
  private readonly primary: TranslationProvider;
  private readonly secondary: TranslationProvider;
  private readonly circuit: HostCircuit;

  constructor(config: FailoverTranslationProviderConfig) {
    this.name = config.name;
    this.primary = config.primary;
    this.secondary = config.secondary;
    this.circuit = config.circuit;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    // A requested ladder names the primary's models, which mean nothing to the
    // secondary's host; it serves its own.
    const forSecondary = { ...req, models: undefined };
    if (this.circuit.isOpen()) return this.secondary.translate(forSecondary);

    let forwarded = false;
    const onChunk = req.onChunk;
    try {
      return await this.primary.translate({
        ...req,
        onChunk: onChunk
          ? (delta, restart) => {
              forwarded = true;
              onChunk(delta, restart);
            }
          : undefined,
      });
    } catch (err) {
      tripOnPersistentFailure(this.circuit, err);
      if (!onChunk) return this.secondary.translate(forSecondary);
      // The text already on screen belongs to the attempt that failed. A
      // provider announces a restart on its own first chunk anyway; this makes
      // it true whatever the secondary does.
      let first = true;
      return this.secondary.translate({
        ...forSecondary,
        onChunk: (delta, restart) => {
          onChunk(delta, restart || (first && forwarded));
          first = false;
        },
      });
    }
  }
}
