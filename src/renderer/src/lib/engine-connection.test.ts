import { describe, expect, it, vi } from 'vitest';
import { runEngineConnectionAttempt } from './engine-connection';

describe('runEngineConnectionAttempt', () => {
  it('does not call a detected CLI connected until ACP succeeds', async () => {
    const actions: unknown[] = [];
    const api = {
      checkGrok: vi.fn().mockResolvedValue({
        status: 'detected',
        binaryPath: '/Users/test/.grok/bin/grok',
        version: 'grok 0.2.112',
        authenticated: null,
      }),
      connectGrok: vi.fn().mockResolvedValue({
        status: 'ready',
        detail: '已通过 ACP 连接本机 Grok Build',
        agentName: 'Grok Build',
        agentVersion: '0.2.112',
      }),
      reconnectGrok: vi.fn(),
    };

    await runEngineConnectionAttempt(api, 7, (action) => actions.push(action));

    expect(actions).toMatchObject([
      { type: 'CONNECTION_ATTEMPT', attemptId: 7 },
      { type: 'GROK_INSPECTED', result: { status: 'detected' } },
      { type: 'CONNECTION_RESULT', result: { status: 'connecting' } },
      { type: 'CONNECTION_RESULT', result: { status: 'ready' } },
    ]);
  });

  it('stops after a missing CLI and leaves an actionable inspection result', async () => {
    const actions: unknown[] = [];
    const api = {
      checkGrok: vi.fn().mockResolvedValue({
        status: 'offline',
        binaryPath: null,
        version: null,
        authenticated: null,
        detail: '未找到 Grok Build。',
        issueCode: 'binary_missing',
        retryable: true,
      }),
      connectGrok: vi.fn(),
      reconnectGrok: vi.fn(),
    };

    await runEngineConnectionAttempt(api, 1, (action) => actions.push(action));

    expect(api.connectGrok).not.toHaveBeenCalled();
    expect(actions).toHaveLength(2);
    expect(actions.at(-1)).toMatchObject({
      type: 'GROK_INSPECTED',
      result: { status: 'offline', issueCode: 'binary_missing' },
    });
  });

  it('removes Electron invoke boilerplate from a rejected diagnostic', async () => {
    const actions: unknown[] = [];
    const api = {
      checkGrok: vi
        .fn()
        .mockRejectedValue(
          new Error("Error invoking remote method 'grok:check': Error: 无法读取 Grok Build 版本。"),
        ),
      connectGrok: vi.fn(),
      reconnectGrok: vi.fn(),
    };

    await runEngineConnectionAttempt(api, 3, (action) => actions.push(action));

    expect(actions.at(-1)).toMatchObject({
      type: 'CONNECTION_RESULT',
      result: { status: 'error', detail: '无法读取 Grok Build 版本。' },
    });
  });

  it('uses the force-reconnect path for an explicit retry', async () => {
    const actions: unknown[] = [];
    const api = {
      checkGrok: vi.fn().mockResolvedValue({
        status: 'detected',
        binaryPath: '/Users/test/.grok/bin/grok',
        version: 'grok 0.2.112',
        authenticated: null,
      }),
      connectGrok: vi.fn(),
      reconnectGrok: vi.fn().mockResolvedValue({
        status: 'ready',
        detail: '本机代理已重新启动并重新验证登录',
      }),
    };

    await runEngineConnectionAttempt(api, 8, (action) => actions.push(action), true);

    expect(api.reconnectGrok).toHaveBeenCalledOnce();
    expect(api.connectGrok).not.toHaveBeenCalled();
    expect(actions.at(-1)).toMatchObject({
      type: 'CONNECTION_RESULT',
      result: { status: 'ready' },
    });
  });
});
