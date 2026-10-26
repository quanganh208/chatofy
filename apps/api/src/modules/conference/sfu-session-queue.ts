/** A lock on one key that its holder gives back. Releasing twice is a no-op. */
export interface SfuSessionHold {
  release(): void;
  /**
   * Stop the timeout but keep the lock: the awaited answer has arrived and is
   * being submitted, so only `release()` may free the key now.
   */
  disarm(): void;
}

interface KeyState {
  busy: boolean;
  waiting: (() => void)[];
}

/**
 * One async queue per SFU session.
 *
 * Cloudflare rejects a mutation on a session whose last SFU offer is still
 * unanswered (HTTP 406), so every call on a session runs alone and in order,
 * and a subscribe that hands the client an offer keeps the session locked —
 * through `hold` — until the client's answer has been submitted.
 *
 * A hold opened from inside a `run` is the same operation continuing, so it
 * goes to the front of the line and takes the key the moment that `run`
 * finishes; nothing queued behind it can slip in between. A hold nobody
 * releases frees the key after `timeoutMs` and reports it to `onTimeout`.
 */
export class SfuSessionQueue {
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly onTimeout: (key: string) => void) {}

  /** Run `fn` once every earlier call and hold on `key` is done. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.enqueue(key, false, () => {
        // Through a resolved promise, so a `fn` that throws synchronously
        // still frees the key.
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => this.finish(key));
      });
    });
  }

  /** Keep `key` locked until `release()`, or until `timeoutMs` passes. */
  hold(key: string, timeoutMs: number): SfuSessionHold {
    let released = false;
    let started = false;
    const timer = setTimeout(() => {
      if (released) return;
      release();
      this.onTimeout(key);
    }, timeoutMs);
    timer.unref?.();
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      // Released before it reached the front: it never took the key, so
      // there is nothing to hand on. `start` below sees the flag and finishes.
      if (started) this.finish(key);
    };
    const state = this.keys.get(key);
    this.enqueue(key, state?.busy ?? false, () => {
      started = true;
      if (released) this.finish(key);
    });
    const disarm = () => clearTimeout(timer);
    return { release, disarm };
  }

  private enqueue(key: string, front: boolean, start: () => void): void {
    let state = this.keys.get(key);
    if (!state) {
      state = { busy: false, waiting: [] };
      this.keys.set(key, state);
    }
    if (front) state.waiting.unshift(start);
    else state.waiting.push(start);
    this.next(key, state);
  }

  private finish(key: string): void {
    const state = this.keys.get(key);
    if (!state) return;
    state.busy = false;
    this.next(key, state);
  }

  private next(key: string, state: KeyState): void {
    if (state.busy) return;
    const start = state.waiting.shift();
    if (!start) {
      this.keys.delete(key);
      return;
    }
    state.busy = true;
    start();
  }
}
