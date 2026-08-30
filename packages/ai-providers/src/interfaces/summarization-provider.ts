// SummarizationProvider contract — one LLM pass over a finished conversation
// that returns structured minutes (summary + key points + decisions + action
// items). Text-in, structured-out; no audio, no streaming.
//
// The provider returns a DRAFT: the semantic content only. Stable ids for the
// action items, the generated-at instant, and the persisted status are assigned
// by the application when it maps this draft onto the domain MeetingMinutes —
// they are storage concerns, not model output, and minting them here would put
// non-deterministic ids inside a unit whose whole value is being pure over its
// input.
import type { LanguageCode, ProviderConfig } from './provider-types.js';

export interface SummarizationProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

/** One action item as the model proposes it, before the app assigns an id. */
export interface ActionItemDraft {
  description: string;
  owner: string | null;
  dueDate: string | null;
}

export interface SummarizationRequest {
  /**
   * The whole conversation as newline-joined `Label: text` lines, in the
   * language it happened in.
   *
   * Passed as one block rather than a turn array because the provider treats it
   * as opaque data behind the prompt-injection boundary (see the prompt
   * builder): the fewer places that reshape it, the fewer places that can let a
   * turn's text escape the fenced region and be read as instruction.
   */
  transcript: string;
  /** Language to WRITE the minutes in. Omitted lets the model mirror the input. */
  language?: LanguageCode;
}

export interface MeetingMinutesDraft {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItemDraft[];
  /** The model that actually produced the draft (a provider may fall back). */
  model: string;
}

export interface SummarizationProvider {
  readonly name: string;
  summarize(req: SummarizationRequest): Promise<MeetingMinutesDraft>;
}
