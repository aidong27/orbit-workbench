import { fileURLToPath } from 'node:url';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcpSessionEvent, PermissionRequestEvent } from '../shared/types';
import { GrokAcpManager } from './grok-acp';

const fakeAgentPath = fileURLToPath(
  new URL('../../test/fixtures/fake-grok-acp.mjs', import.meta.url),
);

type SentMessage = {
  channel: string;
  payload: unknown;
};

type FakeWebContents = {
  webContents: WebContents;
  messages: SentMessage[];
};

function fakeWebContents(id: number): FakeWebContents {
  const messages: SentMessage[] = [];
  return {
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        messages.push({ channel, payload });
      },
    } as unknown as WebContents,
    messages,
  };
}

function channelPayloads<T>(contents: FakeWebContents, channel: string): T[] {
  return contents.messages
    .filter((message) => message.channel === channel)
    .map((message) => message.payload as T);
}

async function waitForPayload<T>(
  contents: FakeWebContents,
  channel: string,
  predicate: (payload: T) => boolean = () => true,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const match = channelPayloads<T>(contents, channel).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${channel}`);
}

async function waitForPayloadCount<T>(
  contents: FakeWebContents,
  channel: string,
  count: number,
): Promise<T[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const payloads = channelPayloads<T>(contents, channel);
    if (payloads.length >= count) return payloads;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} ${channel} messages`);
}

const describeOnSupportedPlatform =
  process.platform === 'win32' ? describe.skip : describe.sequential;

describeOnSupportedPlatform('GrokAcpManager fake ACP process integration', () => {
  const previousGrokBinary = process.env.GROK_BINARY;
  let manager: GrokAcpManager;

  beforeEach(() => {
    process.env.GROK_BINARY = fakeAgentPath;
    manager = new GrokAcpManager('integration-test');
  });

  afterEach(async () => {
    try {
      await manager.shutdown();
    } finally {
      if (previousGrokBinary === undefined) delete process.env.GROK_BINARY;
      else process.env.GROK_BINARY = previousGrokBinary;
    }
  });

  it('connects, creates a session, and routes interleaved message and plan events only to its owner', async () => {
    const owner = fakeWebContents(101);
    const otherWindow = fakeWebContents(202);
    manager.registerWebContents(owner.webContents);
    manager.registerWebContents(otherWindow.webContents);

    const session = await manager.createSession(process.cwd(), owner.webContents.id);

    expect(session).toMatchObject({
      sessionId: 'fake-session-1',
      currentModeId: 'plan',
      availableModes: expect.arrayContaining([
        expect.objectContaining({ id: 'normal' }),
        expect.objectContaining({ id: 'plan' }),
      ]),
    });
    expect(
      channelPayloads(owner, 'grok:connection-event').some(
        (event) => (event as { status?: string }).status === 'ready',
      ),
    ).toBe(true);

    const earlyEvents = channelPayloads<AcpSessionEvent>(owner, 'grok:session-update').map(
      (payload) => payload.event,
    );
    expect(earlyEvents).toContainEqual({ type: 'mode.confirmed', currentModeId: 'plan' });
    expect(earlyEvents).toContainEqual({
      type: 'commands.replace',
      commands: [
        {
          name: 'early-review',
          description: 'Emitted before session/new returns',
          inputHint: null,
        },
      ],
      truncated: false,
    });

    await manager.sendPrompt(session.sessionId, 'emit events', owner.webContents.id);

    const events = channelPayloads<AcpSessionEvent>(owner, 'grok:session-update').map(
      (payload) => payload.event,
    );
    expect(events.filter((event) => event.type === 'message.chunk').slice(0, 3)).toEqual([
      { type: 'message.chunk', role: 'assistant', messageId: 'message-a', text: 'A1' },
      { type: 'message.chunk', role: 'assistant', messageId: 'message-b', text: 'B1' },
      { type: 'message.chunk', role: 'assistant', messageId: 'message-a', text: 'A2' },
    ]);
    expect(events).toContainEqual({
      type: 'plan.items',
      planId: 'plan-items',
      entries: [
        {
          content: 'Inspect the protocol boundary',
          priority: 'high',
          status: 'in_progress',
        },
      ],
      truncated: false,
    });
    expect(events).toContainEqual({
      type: 'plan.markdown',
      planId: 'plan-markdown',
      markdown: '# Verified plan\n\n- Keep the UI truthful',
      truncated: false,
    });
    expect(events).toContainEqual({
      type: 'plan.file',
      planId: 'plan-file',
      uri: 'file:///workspace/PLAN.md',
      truncated: false,
    });
    expect(events).toContainEqual({ type: 'plan.remove', planId: 'plan-file' });
    expect(events).toContainEqual({ type: 'turn.completed', stopReason: 'end_turn', usage: null });
    expect(channelPayloads(otherWindow, 'grok:session-update')).toEqual([]);
  });

  it('includes permission origin and maps a bounded option id back to the agent original', async () => {
    const owner = fakeWebContents(303);
    const otherWindow = fakeWebContents(404);
    manager.registerWebContents(owner.webContents);
    manager.registerWebContents(otherWindow.webContents);
    const workspacePath = process.cwd();
    const session = await manager.createSession(workspacePath, owner.webContents.id);

    const prompt = manager.sendPrompt(
      session.sessionId,
      'request permission',
      owner.webContents.id,
    );
    const request = await waitForPayload<PermissionRequestEvent>(
      owner,
      'grok:permission-request',
      (payload) => payload.sessionId === session.sessionId,
    );

    expect(request.workspacePath).toBe(workspacePath);
    expect(request.sessionId).toBe(session.sessionId);
    expect(request.expiresAt).toBeGreaterThan(Date.now());
    expect(request.toolCall).toMatchObject({
      toolCallId: 'permission-tool',
      title: 'Delete generated output',
      status: 'pending',
    });
    expect(request.options[0]?.optionId).not.toBe(`allow-original::${'x'.repeat(1_200)}`);
    expect(request.options[0]?.optionId.length).toBeLessThanOrEqual(1_024);
    expect(channelPayloads(otherWindow, 'grok:permission-request')).toEqual([]);

    manager.resolvePermission(
      { requestId: request.requestId, optionId: request.options[0]?.optionId },
      owner.webContents.id,
    );
    await prompt;

    const resultEvent = channelPayloads<AcpSessionEvent>(owner, 'grok:session-update').find(
      (payload) =>
        payload.event.type === 'message.chunk' && payload.event.messageId === 'permission-result',
    );
    expect(resultEvent?.event).toMatchObject({
      type: 'message.chunk',
      text: 'original-option-restored',
    });
  });

  it('rejects a mode switch rejected by the agent', async () => {
    const owner = fakeWebContents(505);
    manager.registerWebContents(owner.webContents);
    const session = await manager.createSession(process.cwd(), owner.webContents.id);

    const rejection = await manager
      .setSessionMode(session.sessionId, 'reject-mode', owner.webContents.id)
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message.length).toBeLessThanOrEqual(4_000);
    expect((rejection as Error).message).not.toContain('secret');
    await expect(
      manager.setSessionMode(session.sessionId, 'plan', owner.webContents.id),
    ).resolves.toBeUndefined();
  });

  it('bounds a permission flood per turn and cancels excess requests before IPC', async () => {
    const owner = fakeWebContents(606);
    manager.registerWebContents(owner.webContents);
    const session = await manager.createSession(process.cwd(), owner.webContents.id);
    const prompt = manager.sendPrompt(session.sessionId, 'permission flood', owner.webContents.id);
    const requests = await waitForPayloadCount<PermissionRequestEvent>(
      owner,
      'grok:permission-request',
      8,
    );

    expect(requests).toHaveLength(8);
    for (const request of requests) {
      manager.resolvePermission(
        { requestId: request.requestId, optionId: request.options[0]?.optionId },
        owner.webContents.id,
      );
    }
    await prompt;

    expect(channelPayloads(owner, 'grok:permission-request')).toHaveLength(8);
    expect(channelPayloads<AcpSessionEvent>(owner, 'grok:session-update')).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'message.chunk',
          messageId: 'permission-flood-result',
          text: 'selected-8',
        }),
      }),
    );
  });

  it('fails closed instead of silently dropping an overflowing early-event buffer', async () => {
    const owner = fakeWebContents(707);
    manager.registerWebContents(owner.webContents);

    await expect(
      manager.createSession(`${process.cwd()}/early-flood`, owner.webContents.id),
    ).rejects.toThrow();
    await expect(
      waitForPayload<{ status: string; detail?: string }>(
        owner,
        'grok:connection-event',
        (event) => event.status === 'error' && Boolean(event.detail?.includes('安全上限')),
      ),
    ).resolves.toMatchObject({ status: 'error', detail: expect.stringContaining('安全上限') });
  });

  it('invalidates the connection when an agent reports an undeclared active mode', async () => {
    const owner = fakeWebContents(808);
    manager.registerWebContents(owner.webContents);
    const session = await manager.createSession(process.cwd(), owner.webContents.id);

    await expect(
      manager.sendPrompt(session.sessionId, 'unknown mode', owner.webContents.id),
    ).rejects.toThrow();
    await expect(
      waitForPayload<{ status: string; detail?: string }>(
        owner,
        'grok:connection-event',
        (event) => event.status === 'error' && Boolean(event.detail?.includes('状态失真')),
      ),
    ).resolves.toMatchObject({ status: 'error', detail: expect.stringContaining('状态失真') });
  });
});
