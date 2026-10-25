/**
 * A token bucket: holds up to `capacity` tokens and regains `refillPerSecond`
 * of them continuously. `take(n)` spends `n` if they are there and refuses
 * otherwise — a refusal spends nothing.
 *
 * Used for per-peer rate limits on the conference socket, where one peer's
 * message is fanned out to (and, for chat, translated for) everyone else.
 */
export class TokenBucket {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowMs = Date.now(),
  ) {
    this.tokens = capacity;
    this.refilledAt = nowMs;
  }

  take(amount = 1, nowMs = Date.now()): boolean {
    const elapsedS = Math.max(0, nowMs - this.refilledAt) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedS * this.refillPerSecond,
    );
    this.refilledAt = nowMs;
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }
}
