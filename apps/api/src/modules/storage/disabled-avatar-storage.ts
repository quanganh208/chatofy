import type { AvatarStorage } from './interfaces/avatar-storage.interface';
import { AvatarStorageUnavailableError } from './interfaces/avatar-storage.interface';

/**
 * What binds when R2 is unconfigured.
 *
 * `delete` throws rather than resolving, and that is deliberate. Letting it
 * succeed would make "remove my photo" report 200 on a deployment that cannot
 * remove anything — and on a public-read bucket the bytes would stay published.
 * The endpoint turns this into a retryable 4xx with the columns left intact.
 */
export class DisabledAvatarStorage implements AvatarStorage {
  readonly enabled = false;

  async put(): Promise<void> {
    throw new AvatarStorageUnavailableError();
  }

  async delete(): Promise<void> {
    throw new AvatarStorageUnavailableError();
  }
}
