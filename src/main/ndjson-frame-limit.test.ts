import { describe, expect, it } from 'vitest';
import {
  limitNdjsonFrameBytes,
  NDJSON_FRAME_TOO_LARGE_MESSAGE,
  NdjsonFrameTooLargeError,
} from './ndjson-frame-limit';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sourceFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }

  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}

describe('limitNdjsonFrameBytes', () => {
  it('preserves multiple frames and resets the count after every newline', async () => {
    const source = sourceFromChunks(['1234\n12', '345\n\nabc\n']);

    await expect(readText(limitNdjsonFrameBytes(source, 5))).resolves.toBe('1234\n12345\n\nabc\n');
  });

  it('allows a frame whose byte length is exactly the configured limit', async () => {
    const source = sourceFromChunks(['你', '好\n']);

    await expect(readText(limitNdjsonFrameBytes(source, 6))).resolves.toBe('你好\n');
  });

  it('rejects an oversized frame whose bytes arrive across chunks', async () => {
    const source = sourceFromChunks(['123', '45', '6\n']);

    await expect(readText(limitNdjsonFrameBytes(source, 5))).rejects.toBeInstanceOf(
      NdjsonFrameTooLargeError,
    );
  });

  it('uses a fixed error that does not disclose the rejected payload', async () => {
    const secret = `xai${'-'}secret-that-must-not-appear`;
    const source = sourceFromChunks([secret]);

    try {
      await readText(limitNdjsonFrameBytes(source, 8));
      throw new Error('Expected the limited stream to reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(NdjsonFrameTooLargeError);
      expect(error).toMatchObject({
        name: 'NdjsonFrameTooLargeError',
        message: NDJSON_FRAME_TOO_LARGE_MESSAGE,
      });
      expect(String(error)).not.toContain(secret);
      expect(error instanceof Error ? error.stack : '').not.toContain(secret);
    }
  });

  it('rejects invalid byte limits before consuming the source', () => {
    const source = sourceFromChunks(['{}\n']);

    expect(() => limitNdjsonFrameBytes(source, 0)).toThrow(
      'maxFrameBytes must be a positive safe integer.',
    );
  });
});
