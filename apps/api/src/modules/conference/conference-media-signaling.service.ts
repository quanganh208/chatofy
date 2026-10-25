import { Injectable, Logger } from '@nestjs/common';
import type { types } from 'mediasoup';
import {
  ConferenceConsumeSchema,
  ConferenceConsumerResumeSchema,
  ConferenceParticipantMuteSchema,
  ConferenceParticipantVideoSchema,
  ConferenceProduceSchema,
  ConferenceTransportConnectSchema,
  ConferenceTransportCreateSchema,
} from '@chatofy/types';
import type { z } from 'zod';
import {
  ConferencePeerLifecycle,
  type Seat,
} from './conference-peer-lifecycle.service';
import type { ParticipantSession } from './conference-room-registry.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import {
  parsePayload,
  sendEvent,
  type ConferenceSocket,
} from './conference-socket';
import { ConferenceWebRtcTransportFactory } from './conference-webrtc-transport.factory';

/** One microphone and one camera. */
const MAX_PRODUCERS_PER_PEER = 2;
/**
 * Two tracks from each of 32 other peers. A legitimate client consumes each
 * remote producer once; this bounds a client that loops `consume`.
 */
const MAX_CONSUMERS_PER_PEER = 64;

/**
 * SFU signaling: transports, producers, consumers, and the mute/video state
 * peers display. Every handler validates its body, resolves the caller's peer,
 * and replies on its own event name with the result or `{ error: <code> }`.
 */
@Injectable()
export class ConferenceMediaSignaling {
  private readonly logger = new Logger(ConferenceMediaSignaling.name);

  constructor(
    private readonly lifecycle: ConferencePeerLifecycle,
    private readonly sockets: ConferenceSocketRegistry,
    private readonly transports: ConferenceWebRtcTransportFactory,
  ) {}

  createTransport(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.transport.create',
      ConferenceTransportCreateSchema,
      body,
      async ({ direction }, resolved, reply) => {
        const { room, peer } = resolved;
        const current =
          direction === 'send' ? peer.sendTransport : peer.recvTransport;
        // One transport per direction. Each holds a UDP and a TCP port from
        // the worker's range for as long as it lives, so a client that loops
        // this call could otherwise exhaust the range for every room.
        if (current || peer.creatingTransports.has(direction)) {
          reply({ error: 'transport_exists' });
          return;
        }
        peer.creatingTransports.add(direction);
        try {
          const transport = await this.transports.create(room.router);
          if (!this.lifecycle.isCurrent(resolved)) {
            transport.close();
            return;
          }
          if (direction === 'send') peer.sendTransport = transport;
          else peer.recvTransport = transport;
          reply({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            iceServers: this.transports.iceServers(peer.userId),
          });
        } finally {
          peer.creatingTransports.delete(direction);
        }
      },
    );
  }

  connectTransport(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.transport.connect',
      ConferenceTransportConnectSchema,
      body,
      async ({ transportId, dtlsParameters }, { peer }, reply) => {
        const transport = [peer.sendTransport, peer.recvTransport].find(
          (t) => t?.id === transportId,
        );
        if (!transport) {
          reply({ error: 'invalid_payload' });
          return;
        }
        // Shape-checked by the schema; mediasoup validates the rest and throws.
        await transport.connect({
          dtlsParameters: dtlsParameters as types.DtlsParameters,
        });
        reply({ connected: true });
      },
    );
  }

  produce(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.produce',
      ConferenceProduceSchema,
      body,
      async (input, resolved, reply) => {
        const { room, peer, socketId } = resolved;
        if (!peer.sendTransport) {
          reply({ error: 'invalid_payload' });
          return;
        }
        if (peer.producers.size >= MAX_PRODUCERS_PER_PEER) {
          reply({ error: 'limit_reached' });
          return;
        }
        const producer = await peer.sendTransport.produce({
          kind: input.kind,
          // Shape-checked by the schema; mediasoup validates the rest and throws.
          rtpParameters: input.rtpParameters as types.RtpParameters,
          appData: input.appData ?? {},
        });
        if (!this.lifecycle.isCurrent(resolved)) {
          producer.close();
          return;
        }
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => peer.producers.delete(producer.id));
        this.sockets.sendToRoom(room, socketId, 'conference.new.producer', {
          producerId: producer.id,
          socketId,
          kind: producer.kind,
          appData: producer.appData,
        });
        reply({ id: producer.id });
      },
    );
  }

  consume(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.consume',
      ConferenceConsumeSchema,
      body,
      async (input, resolved, reply) => {
        const { room, peer } = resolved;
        const rtpCapabilities = input.rtpCapabilities as types.RtpCapabilities;
        if (!peer.recvTransport) {
          reply({ error: 'invalid_payload' });
          return;
        }
        if (peer.consumers.size >= MAX_CONSUMERS_PER_PEER) {
          reply({ error: 'limit_reached' });
          return;
        }
        if (
          !room.router.canConsume({
            producerId: input.producerId,
            rtpCapabilities,
          })
        ) {
          reply({ error: 'invalid_payload' });
          return;
        }
        const consumer = await peer.recvTransport.consume({
          producerId: input.producerId,
          rtpCapabilities,
          paused: true,
        });
        if (!this.lifecycle.isCurrent(resolved)) {
          consumer.close();
          return;
        }
        trackConsumer(peer, consumer);
        reply({
          id: consumer.id,
          producerId: input.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      },
    );
  }

  resumeConsumer(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.consumer.resume',
      ConferenceConsumerResumeSchema,
      body,
      async ({ consumerId }, { peer }, reply) => {
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) {
          reply({ error: 'invalid_payload' });
          return;
        }
        await consumer.resume();
        reply({ resumed: true });
      },
    );
  }

  setMuted(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.participant.mute',
      ConferenceParticipantMuteSchema,
      body,
      ({ muted }, resolved, reply) => {
        resolved.peer.muted = muted;
        this.broadcastState(resolved);
        reply({ muted });
        return Promise.resolve();
      },
    );
  }

  setVideoEnabled(ws: ConferenceSocket, body: unknown): Promise<void> {
    return this.run(
      ws,
      'conference.participant.video',
      ConferenceParticipantVideoSchema,
      body,
      ({ videoEnabled }, resolved, reply) => {
        resolved.peer.videoEnabled = videoEnabled;
        this.broadcastState(resolved);
        reply({ videoEnabled });
        return Promise.resolve();
      },
    );
  }

  private broadcastState({ room, peer, socketId }: Seat): void {
    this.sockets.sendToRoom(room, socketId, 'conference.participant.state', {
      socketId,
      muted: peer.muted,
      videoEnabled: peer.videoEnabled,
    });
  }

  /**
   * The shared envelope: parse, resolve the peer, run, and turn any throw
   * (mediasoup rejecting parameters, a closed transport) into `internal_error`
   * without forwarding its message.
   */
  private async run<T>(
    ws: ConferenceSocket,
    event: string,
    schema: z.ZodType<T>,
    body: unknown,
    handler: (
      input: T,
      resolved: Seat,
      reply: (data: unknown) => void,
    ) => Promise<void>,
  ): Promise<void> {
    const reply = (data: unknown) => sendEvent(ws, event, data);
    const input = parsePayload(schema, body);
    if (!input) {
      reply({ error: 'invalid_payload' });
      return;
    }
    const resolved = this.lifecycle.resolvePeer(ws);
    if ('error' in resolved) {
      reply(resolved);
      return;
    }
    try {
      await handler(input, resolved, reply);
    } catch (err) {
      this.logger.error(`${event} failed for ${resolved.socketId}`, err);
      reply({ error: 'internal_error' });
    }
  }
}

/** Keep `peer.consumers` in step with consumers mediasoup closes on its own. */
function trackConsumer(peer: ParticipantSession, consumer: types.Consumer) {
  peer.consumers.set(consumer.id, consumer);
  const forget = () => peer.consumers.delete(consumer.id);
  consumer.on('transportclose', forget);
  consumer.on('producerclose', forget);
}
