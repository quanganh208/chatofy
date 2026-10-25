import { Injectable, Logger } from '@nestjs/common';
import {
  ConferenceChatSendSchema,
  MAX_CONFERENCE_CHAT_TEXT_CHARS,
  type ConferenceChatMessage,
  type LanguageCode,
} from '@chatofy/types';
import { PipelineTranslatorService } from '../../translate/services/pipeline-translator.service';
import { ConferencePeerLifecycle } from '../conference-peer-lifecycle.service';
import { TokenBucket } from '../conference-token-bucket';
import { ConferenceSocketRegistry } from '../conference-socket-registry.service';
import {
  parsePayload,
  sendEvent,
  type ConferenceSocket,
} from '../conference-socket';
import { ConferencePersistenceService } from './conference-persistence.service';

/** A burst of this many messages is allowed… */
export const CHAT_BURST = 5;
/** …refilling at this many per {@link CHAT_REFILL_WINDOW_MS}. */
const CHAT_REFILL_WINDOW_MS = 10_000;

const SEND_EVENT = 'conference.chat';
const MESSAGE_EVENT = 'conference.chat.message';

/**
 * In-meeting text chat, translated per recipient.
 *
 * One sent message is translated into every distinct recipient language in
 * the room and fanned out per peer; a recipient sharing the sender's language
 * gets the original text, and the sender gets an echo of their own original.
 * If translation throws (provider hiccup), everyone receives the original text
 * so chat never breaks. Each message is stored once, in the sender's language.
 *
 * Every message costs a translation call per target language, so each peer
 * has a token bucket: {@link CHAT_BURST} messages, refilling over 10 s.
 */
@Injectable()
export class ConferenceChat {
  private readonly logger = new Logger(ConferenceChat.name);

  constructor(
    private readonly lifecycle: ConferencePeerLifecycle,
    private readonly sockets: ConferenceSocketRegistry,
    private readonly translator: PipelineTranslatorService,
    private readonly persistence: ConferencePersistenceService,
  ) {}

  async send(ws: ConferenceSocket, body: unknown): Promise<void> {
    const reply = (data: unknown) => sendEvent(ws, SEND_EVENT, data);
    const input = parsePayload(ConferenceChatSendSchema, body);
    if (!input) {
      reply({ error: isTooLong(body) ? 'text_too_long' : 'invalid_payload' });
      return;
    }
    const resolved = this.lifecycle.resolvePeer(ws);
    if ('error' in resolved) {
      reply(resolved);
      return;
    }
    const { room, peer, socketId } = resolved;
    peer.limits.chat ??= new TokenBucket(
      CHAT_BURST,
      CHAT_BURST / (CHAT_REFILL_WINDOW_MS / 1000),
    );
    if (!peer.limits.chat.take()) {
      reply({ error: 'limit_reached' });
      return;
    }

    const { text } = input;
    const senderLang = peer.sourceLanguage;
    const message: Omit<ConferenceChatMessage, 'text' | 'lang'> = {
      id: crypto.randomUUID(),
      socketId,
      displayName: peer.displayName,
      sentAt: Date.now(),
    };

    void this.persistence.recordMessage(peer.participantId, room.id, {
      text,
      sourceLanguage: senderLang,
    });

    // Echo the original to the sender in their own language.
    sendEvent(ws, MESSAGE_EVENT, { ...message, text, lang: senderLang });

    const recipients = [...room.peers.entries()].filter(
      ([sid]) => sid !== socketId,
    );
    if (recipients.length === 0) return;

    const targets = [
      ...new Set(
        recipients
          .map(([, p]) => p.sourceLanguage)
          .filter((lang) => lang !== senderLang),
      ),
    ];
    const byLang = await this.translate(text, senderLang, targets);

    for (const [sid, p] of recipients) {
      this.sockets.sendTo(sid, MESSAGE_EVENT, {
        ...message,
        text: byLang.get(p.sourceLanguage) ?? text,
        lang: p.sourceLanguage,
      });
    }
  }

  /** Text keyed by language; the sender's language maps to the original. */
  private async translate(
    text: string,
    source: LanguageCode,
    targets: LanguageCode[],
  ): Promise<Map<LanguageCode, string>> {
    const byLang = new Map<LanguageCode, string>([[source, text]]);
    if (targets.length === 0) return byLang;
    try {
      const translations = await this.translator.translateAll({
        text,
        source,
        targets,
      });
      for (const target of targets) {
        byLang.set(target, translations[target] ?? text);
      }
    } catch (err) {
      // Provider hiccup: every target falls back to the original via `?? text`.
      this.logger.error('conference.chat translateAll failed', err);
    }
    return byLang;
  }
}

function isTooLong(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('text' in body)) {
    return false;
  }
  const { text } = body;
  return (
    typeof text === 'string' &&
    text.trim().length > MAX_CONFERENCE_CHAT_TEXT_CHARS
  );
}
