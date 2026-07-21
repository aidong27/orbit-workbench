import type { UiAcpEvent } from '../../../shared/types';

export type StreamChunkEvent = Extract<UiAcpEvent, { type: 'message.chunk' | 'thought.chunk' }>;

export function streamChunkKey(sessionId: string, event: StreamChunkEvent): string {
  const role = event.type === 'message.chunk' ? event.role : 'thought';
  return JSON.stringify([sessionId, event.type, role, event.messageId]);
}
