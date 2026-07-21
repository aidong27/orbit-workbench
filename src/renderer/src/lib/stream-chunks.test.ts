import { describe, expect, it } from 'vitest';
import { streamChunkKey } from './stream-chunks';

describe('streamChunkKey', () => {
  it('keeps a missing message id distinct from a literal legacy id', () => {
    const withoutId = streamChunkKey('session', {
      type: 'message.chunk',
      role: 'assistant',
      messageId: null,
      text: 'a',
    });
    const literalLegacy = streamChunkKey('session', {
      type: 'message.chunk',
      role: 'assistant',
      messageId: 'legacy',
      text: 'b',
    });

    expect(withoutId).not.toBe(literalLegacy);
  });

  it('cannot be confused by separator characters inside protocol identifiers', () => {
    const first = streamChunkKey('a\0b', {
      type: 'thought.chunk',
      messageId: 'c',
      text: 'a',
    });
    const second = streamChunkKey('a', {
      type: 'thought.chunk',
      messageId: 'b\0c',
      text: 'b',
    });

    expect(first).not.toBe(second);
  });
});
