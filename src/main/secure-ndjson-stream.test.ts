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

  it('ignores bounded Grok vendor notifications and continues reading ACP messages', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const stream = secureNdjsonStream(
      output.writable,
      byteInput(
        [
          JSON.stringify({
            jsonrpc: '2.0',
            method: '_x.ai/mcp/servers_updated',
            params: { servers: [] },
          }),
          JSON.stringify({
            jsonrpc: '2.0',
            method: '_x.ai/announcements/update',
            params: { announcements: [] },
          }),
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
          '',
        ].join('\n'),
      ),
    );
    const reader = stream.readable.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      value: { jsonrpc: '2.0', id: 1, result: {} },
      done: false,
    });
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true });
  });

  it.each([undefined, null, [], 'invalid'])(
    'rejects Grok vendor notifications with malformed params: %j',
    async (params) => {
      const output = new TransformStream<Uint8Array, Uint8Array>();
      const secret = 'xai-secret-value-that-must-not-be-logged';
      const notification: Record<string, unknown> = {
        jsonrpc: '2.0',
        method: '_x.ai/announcements/update',
      };
      if (params !== undefined) notification.params = params;
      notification.payload = secret;
      const stream = secureNdjsonStream(
        output.writable,
        byteInput(`${JSON.stringify(notification)}\n`),
      );

      await expect(stream.readable.getReader().read()).rejects.toThrow(
        secureNdjsonTestHelpers.INVALID_FRAME_MESSAGE,
      );
    },
  );

  it('does not ignore vendor methods that carry a request id', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const request = {
      jsonrpc: '2.0',
      id: 7,
      method: '_x.ai/extension/request',
      params: {},
    };
    const stream = secureNdjsonStream(output.writable, byteInput(`${JSON.stringify(request)}\n`));

    await expect(stream.readable.getReader().read()).resolves.toMatchObject({
      value: request,
      done: false,
    });
  });

  it('continues rejecting unknown non-vendor notifications', async () => {
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const stream = secureNdjsonStream(
      output.writable,
      byteInput(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'example.com/unsupported',
          params: {},
        })}\n`,
      ),
    );

    await expect(stream.readable.getReader().read()).rejects.toThrow(
      secureNdjsonTestHelpers.INVALID_FRAME_MESSAGE,
    );
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
