import { Injectable } from '@nestjs/common';
import type { ConferenceRoom } from '../conference-room-registry.service';

export interface SubtitlePayload {
  speakerSocketId?: string;
  speakerDisplayName?: string;
  sourceLanguage?: string;
  sourceText?: string;
  translatedText?: string;
  isFinal?: boolean;
  [k: string]: unknown;
}

/**
 * Routes translated subtitle and audio frames to eligible room peers.
 *
 * Rules:
 * 1. Never send back to the socket that produced the content (self-filter).
 * 2. Skip peers whose sourceLanguage matches the sender's sourceLanguage —
 *    they already understand the speaker. Exception: peers with no known
 *    sourceLanguage receive everything (treat as "all languages").
 */
@Injectable()
export class ConferenceTranslationRouter {
  routeSubtitle(
    room: ConferenceRoom,
    senderSocketId: string,
    payload: SubtitlePayload,
    broadcast: (socketId: string, event: string, data: unknown) => void,
  ): void {
    const senderLang = this.senderLanguage(
      room,
      senderSocketId,
      payload.sourceLanguage,
    );

    for (const [socketId, peer] of room.peers.entries()) {
      // Rule 1: never echo back to the sender.
      if (socketId === senderSocketId) continue;

      // Rule 2: skip peers who share the sender's language (they understand the speaker).
      // Peers with no sourceLanguage (empty string or undefined-equivalent) always receive.
      if (
        senderLang &&
        peer.sourceLanguage &&
        peer.sourceLanguage === senderLang
      )
        continue;

      broadcast(socketId, 'conference.translation.subtitle', payload);
    }
  }

  routeAudio(
    room: ConferenceRoom,
    senderSocketId: string,
    payload: unknown,
    broadcast: (socketId: string, event: string, data: unknown) => void,
  ): void {
    for (const [socketId] of room.peers.entries()) {
      if (socketId === senderSocketId) continue;
      broadcast(socketId, 'conference.translation.audio', payload);
    }
  }

  /**
   * Resolve the effective source language for the sender:
   * prefer the payload field (set by the gateway from the translate session),
   * fall back to the registered peer sourceLanguage.
   */
  private senderLanguage(
    room: ConferenceRoom,
    senderSocketId: string,
    payloadLang?: string,
  ): string | undefined {
    if (payloadLang) return payloadLang;
    return room.peers.get(senderSocketId)?.sourceLanguage;
  }
}
