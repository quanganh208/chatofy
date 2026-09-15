import type {
  ConversationAudioObject,
  ConversationAudioStorage,
} from './interfaces/conversation-audio-storage.interface';
import { ConversationAudioUnavailableError } from './interfaces/conversation-audio-storage.interface';

/**
 * What binds when R2 is not configured.
 *
 * The API boots, the transcript half of history keeps working, and the two
 * recording routes answer 409 — the `DisabledAvatarStorage` posture, and for the
 * same reason: a feature that dies with an env var should say so at the endpoint
 * rather than stop the process.
 *
 * Every method THROWS rather than resolving quietly. `put` throwing is what lets
 * the route refuse before it sniffs or stores anything; `delete` throwing is the
 * load-bearing one, for the reason the interface states — a silent no-op on the
 * delete path would report a recording removed while nothing was, and on a
 * public-read bucket that is a conversation left reachable by URL.
 */
export class DisabledConversationAudioStorage implements ConversationAudioStorage {
  readonly enabled = false;

  put(): Promise<void> {
    return Promise.reject(new ConversationAudioUnavailableError());
  }

  get(): Promise<ConversationAudioObject | null> {
    return Promise.reject(new ConversationAudioUnavailableError());
  }

  delete(): Promise<void> {
    return Promise.reject(new ConversationAudioUnavailableError());
  }
}
