import type { ServerEvent, TranscriptSegment } from '@chatofy/types';

/**
 * What the conversation shows, derived from the events the server sends.
 *
 * A reducer rather than a handful of `useState` calls in the hook, because the
 * rule that matters here is about *ordering*: a live line must never survive
 * the finished turn it belonged to, and a late-arriving partial must never
 * reappear underneath it. Ordering bugs are invisible in a component — nothing
 * throws, the screen is simply wrong for a moment — and this project has twice
 * shipped exactly that kind of defect in untested client code. Here it is a
 * pure function, and the ordering can be asserted.
 */

export interface ConversationState {
  /** Finished turns, oldest first. */
  turns: TranscriptSegment[];
  /**
   * What the speaker is saying right now, as far as the recogniser has heard.
   *
   * Empty between turns. Rewritten wholesale on each update rather than
   * appended to: the recogniser re-reads the whole utterance every time and can
   * revise a word it had already offered, so treating this as a growing string
   * would leave the correction behind.
   */
  liveText: string;
  /**
   * A translation of the unfinished sentence, when the turn has run long enough
   * to be worth guessing at. Empty otherwise, including on short turns where the
   * real translation arrives sooner than a guess would be useful.
   */
  liveTranslation: string;
}

export const initialConversationState: ConversationState = {
  turns: [],
  liveText: '',
  liveTranslation: '',
};

/**
 * Starting a fresh conversation, which no server event announces.
 *
 * Kept distinct from the contract rather than faked as one: inventing a
 * `server.*` event for something the server never sends would make the shared
 * schema a lie about what can arrive on the socket.
 */
interface ConversationReset {
  type: 'conversation.reset';
}

export type ConversationAction = ServerEvent | ConversationReset;

export function conversationReducer(
  state: ConversationState,
  event: ConversationAction,
): ConversationState {
  switch (event.type) {
    case 'conversation.reset':
      return initialConversationState;

    case 'server.transcript.partial':
      return { ...state, liveText: event.text };

    case 'server.translation.partial':
      return { ...state, liveTranslation: event.text };

    case 'server.transcript.final':
      // The live lines and the finished turn are the same sentence. Keeping
      // both would show it twice for as long as the next turn takes to start,
      // with the guess sitting under the answer that replaced it.
      return {
        turns: [...state.turns, event.segment],
        liveText: '',
        liveTranslation: '',
      };

    case 'server.session.ended':
      // A turn can end without a transcript — no speech, or a failure. Whatever
      // was on the live lines is not coming back, and leaving it would strand a
      // half sentence above the next turn.
      return state.liveText || state.liveTranslation
        ? { ...state, liveText: '', liveTranslation: '' }
        : state;

    default:
      return state;
  }
}
