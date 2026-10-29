// Whether a primary host is worth asking, shared by every provider that calls it.
//
// The failure this exists for is account-wide: a Command Code plan that has
// spent its usage window answers every model with the same 429 until the window
// resets. Asking it anyway costs each turn a failed round-trip before the
// fallback answers, and the repair stages cannot afford even one. So the first
// such answer opens the circuit for everyone who holds this instance — the
// translator and the respeller alike — and they go straight to the secondary.
import { ProviderResponseError } from '../../errors/provider-errors.js';

export type CircuitState = 'open' | 'closed';

export interface HostCircuitConfig {
  /**
   * How long the primary is skipped once tripped. Five minutes, not the reset
   * time the host names: that time arrives as prose in an error message, and a
   * circuit keyed on parsed prose fails closed the day the wording changes. A
   * fixed cooldown costs one probe per five minutes of an exhausted window.
   */
  cooldownMs?: number;
  now?: () => number;
  /** Fired on each change of state, so a silent fallback is never silent in the logs. */
  onTransition?: (state: CircuitState, reason: string) => void;
}

const DEFAULT_COOLDOWN_MS = 300_000;

export class HostCircuit {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onTransition?: (state: CircuitState, reason: string) => void;
  private openUntil = 0;
  private open = false;

  constructor(config: HostCircuitConfig = {}) {
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = config.now ?? (() => Date.now());
    this.onTransition = config.onTransition;
  }

  /**
   * True while the primary should be skipped. Past the cooldown it reads closed
   * again, which makes the next call the probe: if the host is still refusing,
   * that call trips it straight back open.
   */
  isOpen(): boolean {
    if (!this.open) return false;
    if (this.now() < this.openUntil) return true;
    this.open = false;
    this.onTransition?.('closed', 'cooldown elapsed');
    return false;
  }

  trip(reason: string): void {
    const wasOpen = this.isOpen();
    this.open = true;
    this.openUntil = this.now() + this.cooldownMs;
    if (!wasOpen) this.onTransition?.('open', reason);
  }
}

/**
 * The plan's usage window is spent.
 *
 * The same status also carries a transient refusal ("Upstream model provider is
 * temporarily unavailable"), which is one model's capacity and must not take the
 * whole host out for five minutes, so the status alone is not enough.
 */
export function isUsageLimitError(err: unknown): boolean {
  return (
    err instanceof ProviderResponseError &&
    err.status === 429 &&
    /usage limit|RATE_LIMITED/i.test(err.message)
  );
}

/**
 * A failure that will reproduce on every request until someone changes the
 * configuration: a rejected key, or a model the plan does not include.
 */
export function isCredentialError(err: unknown): boolean {
  return err instanceof ProviderResponseError && (err.status === 401 || err.status === 403);
}

/** Opens `circuit` when `err` says the host will keep refusing; a no-op otherwise. */
export function tripOnPersistentFailure(circuit: HostCircuit, err: unknown): void {
  if (isUsageLimitError(err)) circuit.trip('usage limit');
  else if (isCredentialError(err)) {
    circuit.trip(`rejected with ${(err as ProviderResponseError).status}`);
  }
}
