/**
 * The page-world microphone patch: whether it is registered, and which tabs
 * currently carry it.
 *
 * Both halves are the same feature and fail the same way. If the script is not
 * registered no page is ever patched; if a tab is wrongly believed to be patched
 * the overlay tells the user their speech is reaching the meeting while it goes
 * nowhere. Neither shows up as an error — only as a user talking to no one.
 */

/** One script registration this class keeps in sync with the setting. */
export interface PatchScript {
  id: string;
  [key: string]: unknown;
}

export interface MicrophonePatchDeps {
  /**
   * Ask Chrome, not the page, whether a tab carries the patch.
   *
   * Must resolve false rather than reject for a tab that navigated away or sits
   * outside the host permissions: neither is patched, and neither is a failure
   * worth reporting.
   */
  probe: (tabId: number) => Promise<boolean>;
  /**
   * Registrations currently present, by id.
   *
   * Read rather than tracked, because Chrome persists these across worker
   * restarts: on a fresh worker the work may already be done. Must NOT swallow
   * its own failure — "could not find out" is a different state from "nothing is
   * registered", and treating them alike takes the register branch and throws a
   * duplicate id.
   */
  getRegistered: (ids: string[]) => Promise<{ id: string }[]>;
  register: (scripts: PatchScript[]) => Promise<void>;
  unregister: (ids: string[]) => Promise<void>;
  /** Survive worker restarts. Chrome ends the worker whenever it likes. */
  persist: (tabIds: number[]) => Promise<void>;
  restore: () => Promise<number[]>;
}

export class MicrophonePatchRegistry {
  /** Tabs whose page world carries the patch. Cleared when they navigate. */
  private readonly patched = new Set<number>();

  /**
   * Serialises {@link sync}.
   *
   * It is driven from three places — worker start, every storage change, and the
   * settings handler, which itself writes storage — so two runs overlap
   * routinely. Both would read "nothing registered" and both would call
   * register, and the second throws `Duplicate script ID`. Chaining is enough;
   * there is no ordering requirement beyond "one at a time, last write wins".
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: MicrophonePatchDeps,
    private readonly scripts: PatchScript[],
  ) {}

  has(tabId: number): boolean {
    return this.patched.has(tabId);
  }

  /** Restore the remembered set after a worker restart. */
  async restore(): Promise<void> {
    for (const tabId of await this.deps.restore()) {
      if (typeof tabId === 'number') this.patched.add(tabId);
    }
  }

  /**
   * Re-ask whether a tab carries the patch.
   *
   * Returns whether the answer changed, so the caller can decide whether the
   * overlay needs republishing. It does not publish itself — which tab is on
   * screen is not this class's business.
   */
  async refresh(tabId: number): Promise<boolean> {
    const patched = await this.deps.probe(tabId);
    const had = this.patched.has(tabId);
    if (patched) this.patched.add(tabId);
    else this.patched.delete(tabId);
    if (patched === had) return false;
    await this.deps.persist([...this.patched]);
    return true;
  }

  /**
   * Forget a tab that closed or started navigating.
   *
   * Returns whether anything changed. A navigating tab throws its document away
   * and with it the patch, and `onRemoved` does not fire for that.
   */
  async forget(tabId: number): Promise<boolean> {
    if (!this.patched.delete(tabId)) return false;
    await this.deps.persist([...this.patched]);
    return true;
  }

  /** Register or unregister the patch to match the setting, one run at a time. */
  sync(outbound: boolean): Promise<void> {
    this.queue = this.queue.then(() => this.apply(outbound));
    return this.queue;
  }

  private async apply(outbound: boolean): Promise<void> {
    const ids = this.scripts.map((script) => script.id);
    const existing = await this.deps.getRegistered(ids);
    const present = new Set(existing.map((script) => script.id));

    if (!outbound) {
      const registered = ids.filter((id) => present.has(id));
      if (registered.length > 0) await this.deps.unregister(registered);
      return;
    }

    const missing = this.scripts.filter((script) => !present.has(script.id));
    if (missing.length > 0) await this.deps.register(missing);
  }
}
