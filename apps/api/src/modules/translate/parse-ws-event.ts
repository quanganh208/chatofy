import { Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { z } from 'zod';

/**
 * Validate an incoming message body against a wire contract and narrow it to
 * the event type the calling handler subscribed to.
 *
 * Shared by the turn and live handler families, which speak different unions
 * but validate identically.
 *
 * NOTE ON WHAT A THROW HERE DOES: `WsException` is the right signal and is kept,
 * but today it does not reach the client. `AllExceptionsFilter` is registered
 * globally (`common/common.module.ts`) and deliberately logs and swallows any
 * non-HTTP context (`all-exceptions.filter.ts`), so a malformed frame is
 * currently answered with silence. That is pre-existing, and its own comment
 * defers a WS exception contract "until the gateway is implemented". Any
 * refusal a client must act on therefore has to be EMITTED as a contract event
 * rather than thrown — see the mode-conflict path in `translate.gateway.ts`.
 */
export function parseWsEvent<
  TEvent extends { type: string },
  TType extends TEvent['type'],
>(
  schema: z.ZodType<TEvent>,
  payload: unknown,
  type: TType,
  logger: Logger,
): Extract<TEvent, { type: TType }> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || parsed.data.type !== type) {
    logger.warn(`Malformed ${type} payload`);
    throw new WsException(`Malformed ${type} payload`);
  }
  return parsed.data as Extract<TEvent, { type: TType }>;
}
