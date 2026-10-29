// Minutes over two hosts, with the translator's rule rather than the respeller's.
//
// Nobody is reading a minutes pass while it is written, so a primary that
// failed leaves time for a second call: any failure falls back. The circuit
// decides only whether the primary is asked at all — a spent usage window or a
// rejected key is not worth rediscovering on every press of Generate.
import type {
  MeetingMinutesDraft,
  SummarizationProvider,
  SummarizationRequest,
} from '../../interfaces/summarization-provider.js';
import { type HostCircuit, tripOnPersistentFailure } from './host-circuit.js';

export interface FailoverSummarizationProviderConfig {
  name: string;
  primary: SummarizationProvider;
  /** `null` when the fallback host is not configured: the primary's error stands. */
  secondary: SummarizationProvider | null;
  circuit: HostCircuit;
}

export class FailoverSummarizationProvider implements SummarizationProvider {
  readonly name: string;
  private readonly primary: SummarizationProvider;
  private readonly secondary: SummarizationProvider | null;
  private readonly circuit: HostCircuit;

  constructor(config: FailoverSummarizationProviderConfig) {
    this.name = config.name;
    this.primary = config.primary;
    this.secondary = config.secondary;
    this.circuit = config.circuit;
  }

  async summarize(req: SummarizationRequest): Promise<MeetingMinutesDraft> {
    // With nothing behind it, an open circuit would only turn a working answer
    // into a refusal, so the primary is still asked.
    if (this.secondary && this.circuit.isOpen()) return this.secondary.summarize(req);
    try {
      return await this.primary.summarize(req);
    } catch (err) {
      tripOnPersistentFailure(this.circuit, err);
      if (!this.secondary) throw err;
      return this.secondary.summarize(req);
    }
  }
}
