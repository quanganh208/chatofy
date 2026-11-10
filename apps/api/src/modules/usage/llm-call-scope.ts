import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a paid model request is on behalf of.
 *
 * Providers are process-wide and know nothing about users, so attribution comes
 * from the call site: a handler runs its work inside `llmCallScope.run(...)` and
 * every `LlmCallEvent` emitted anywhere down that async chain — a provider call
 * three awaits deep, a polish that settles after the turn has ended — reads the
 * same store. No provider signature changes to carry it.
 *
 * Either field may be absent: a meeting's chat message has a user but no turn,
 * and a call made outside any scope has neither. Such rows are kept with nulls
 * and still count toward per-host totals.
 */
export interface LlmCallScope {
  userId?: string;
  sessionId?: string;
}

export const llmCallScope = new AsyncLocalStorage<LlmCallScope>();
