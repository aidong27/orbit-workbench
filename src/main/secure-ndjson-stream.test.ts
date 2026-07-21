import * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import { secureNdjsonStream, secureNdjsonTestHelpers } from './secure-ndjson-stream';

function byteInput(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('secureNdjsonStream', () => {
  it('parses object messages without logging their source line', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const stream = secureNdjsonStream(
      output.writable,
      byteInput('{"jsonrpc":"2.0","id":1,"result":{}}\n'),
    );

    await expect(stream.readable.getReader().read()).resolves.toMatchObject({
      value: { jsonrpc: '2.0', id: 1, result: {} },
      done: false,
    });
  });

  it('rejects malformed or non-object frames with a fixed non-leaking error', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'xai-secret-value-that-must-not-be-logged';
    const stream = secureNdjsonStream(output.writable, byteInput(`{${secret}\n`));
    const reader = stream.readable.getReader();

    await expect(reader.read()).rejects.toThrow(secureNdjsonTestHelpers.INVALID_FRAME_MESSAGE);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('blocks an object-shaped malformed ACP notification before the SDK can log raw data', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'xai-secret-value-that-must-not-be-logged';
    const input = byteInput(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'session-1',
          update: { sessionUpdate: 'usage_update', used: secret, size: 1 },
        },
      })}\n`,
    );
    const connection = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async () => undefined,
      }),
      secureNdjsonStream(output.writable, input),
    );

    await connection.closed;
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });
});
