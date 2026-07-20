import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';
import * as acp from '@agentclientprotocol/sdk';
import type { WebContents } from 'electron';
import type {
  AcpSessionEvent,
  CreatedSession,
  GrokConnectionEvent,
  GrokStatus,
  PermissionRequestEvent,
  PermissionResolution,
  PromptResult,
} from '../shared/types';

const execFileAsync = promisify(execFile);
const CONNECTION_TIMEOUT_MS = 20_000;
const PERMISSION_TIMEOUT_MS = 10 * 60_000;

type PermissionResolver = {
  sessionId: string;
  timer: NodeJS.Timeout;
  resolve: (response: acp.RequestPermissionResponse) => void;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGrokBinary(): Promise<string | null> {
  const explicit = process.env.GROK_BINARY?.trim();
  const candidates = [explicit, join(homedir(), '.grok', 'bin', 'grok')].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/env', ['which', 'grok'], {
      timeout: 3_000,
      encoding: 'utf8',
    });
    const discovered = stdout.trim();
    return discovered && (await isExecutable(discovered)) ? discovered : null;
  } catch {
    return null;
  }
}

export async function inspectGrokBinary(): Promise<GrokStatus> {
  const binaryPath = await resolveGrokBinary();
  if (!binaryPath) {
    return {
      status: 'offline',
      binaryPath: null,
      version: null,
      authenticated: null,
      detail: '未找到 Grok Build。请先安装官方 grok CLI。',
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], {
      timeout: 5_000,
      encoding: 'utf8',
    });
    const version = `${stdout}${stderr}`.trim();
    return {
      status: 'ready',
      binaryPath,
      version: version || '已安装',
      authenticated: null,
    };
  } catch (error) {
    return {
      status: 'error',
      binaryPath,
      version: null,
      authenticated: null,
      detail: error instanceof Error ? error.message : '无法读取 Grok Build 版本。',
    };
  }
}

export class GrokAcpManager {
  private process: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private connectPromise: Promise<GrokConnectionEvent> | null = null;
  private webContents = new Set<WebContents>();
  private pendingPermissions = new Map<string, PermissionResolver>();
  private lastStderr = '';

  registerWebContents(contents: WebContents): () => void {
    this.webContents.add(contents);
    return () => this.webContents.delete(contents);
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const contents of this.webContents) {
      if (!contents.isDestroyed()) contents.send(channel, payload);
    }
  }

  private connectionEvent(event: GrokConnectionEvent): GrokConnectionEvent {
    this.broadcast('grok:connection-event', event);
    return event;
  }

  async connect(): Promise<GrokConnectionEvent> {
    if (this.connection && this.process && !this.process.killed) {
      return { status: 'ready', detail: '已连接本机 Grok Build' };
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.startConnection().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async startConnection(): Promise<GrokConnectionEvent> {
    this.connectionEvent({ status: 'checking', detail: '正在启动 Grok ACP…' });
    const binaryPath = await resolveGrokBinary();
    if (!binaryPath) {
      throw new Error('未找到 Grok Build。请先安装官方 grok CLI。');
    }

    const child = spawn(binaryPath, ['--no-auto-update', 'agent', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.process = child;
    this.lastStderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.lastStderr = `${this.lastStderr}${chunk}`.slice(-4_000);
    });
    child.once('exit', (code, signal) => {
      const detail = this.lastStderr.trim() || `Grok ACP 已退出（code=${code}, signal=${signal}）`;
      this.connection = null;
      this.process = null;
      this.cancelAllPermissions();
      this.connectionEvent({ status: code === 0 ? 'offline' : 'error', detail });
    });
    child.once('error', (error) => {
      this.connectionEvent({ status: 'error', detail: error.message });
    });

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    const client: acp.Client = {
      requestPermission: (params) => this.requestPermission(params),
      sessionUpdate: (params) => {
        const event: AcpSessionEvent = {
          sessionId: params.sessionId,
          update: params.update as AcpSessionEvent['update'],
        };
        this.broadcast('grok:session-update', event);
      },
    };

    const connection = new acp.ClientSideConnection(() => client, stream);
    this.connection = connection;

    try {
      const initialized = await withTimeout(
        connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: 'orbit-workbench',
            title: '星轨工作台',
            version: '0.1.0-alpha.1',
          },
        }),
        CONNECTION_TIMEOUT_MS,
        '连接 Grok ACP 超时。',
      );

      const authMethods = initialized.authMethods ?? [];
      const preferredAuth =
        authMethods.find((method) => method.id === 'cached_token') ??
        authMethods.find((method) => method.id === 'xai.api_key') ??
        authMethods.find((method) => method.id.includes('cached'));

      if (preferredAuth) {
        await withTimeout(
          connection.authenticate({
            methodId: preferredAuth.id,
            _meta: { headless: true },
          }),
          CONNECTION_TIMEOUT_MS,
          'Grok 身份验证超时。',
        );
      }

      return this.connectionEvent({
        status: 'ready',
        detail: '已通过 ACP 连接本机 Grok Build',
        agentName: initialized.agentInfo?.title ?? initialized.agentInfo?.name,
        agentVersion: initialized.agentInfo?.version,
      });
    } catch (error) {
      this.stop();
      const detail = error instanceof Error ? error.message : '连接 Grok Build 失败。';
      this.connectionEvent({ status: 'error', detail });
      throw new Error(detail);
    }
  }

  async createSession(cwd: string): Promise<CreatedSession> {
    await this.connect();
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
    const response = await this.connection.newSession({ cwd, mcpServers: [] });
    return {
      sessionId: response.sessionId,
      currentModeId: response.modes?.currentModeId ?? null,
      availableModes: response.modes?.availableModes ?? [],
    };
  }

  async sendPrompt(sessionId: string, text: string): Promise<PromptResult> {
    await this.connect();
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
    try {
      const response = await this.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });
      this.broadcast('grok:session-update', {
        sessionId,
        update: {
          sessionUpdate: 'client_turn_complete',
          stopReason: response.stopReason,
          usage: response.usage,
        },
      } satisfies AcpSessionEvent);
      return { sessionId, stopReason: response.stopReason, usage: response.usage };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Grok 执行失败。';
      this.broadcast('grok:session-update', {
        sessionId,
        update: { sessionUpdate: 'client_turn_error', detail },
      } satisfies AcpSessionEvent);
      throw error;
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (!this.connection) return;
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) this.resolvePermission({ requestId, cancelled: true });
    }
    await this.connection.cancel({ sessionId });
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
    await this.connection.setSessionMode({ sessionId, modeId });
  }

  resolvePermission(resolution: PermissionResolution): void {
    const pending = this.pendingPermissions.get(resolution.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(resolution.requestId);
    if (resolution.cancelled || !resolution.optionId) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
      return;
    }
    pending.resolve({
      outcome: { outcome: 'selected', optionId: resolution.optionId },
    });
  }

  private requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ outcome: { outcome: 'cancelled' } });
      }, PERMISSION_TIMEOUT_MS);
      timer.unref();
      this.pendingPermissions.set(requestId, { sessionId: params.sessionId, timer, resolve });
      const event: PermissionRequestEvent = {
        requestId,
        sessionId: params.sessionId,
        toolCall: params.toolCall as Record<string, unknown>,
        options: params.options,
      };
      this.broadcast('grok:permission-request', event);
    });
  }

  private cancelAllPermissions(): void {
    for (const [requestId] of this.pendingPermissions) {
      this.resolvePermission({ requestId, cancelled: true });
    }
  }

  stop(): void {
    this.cancelAllPermissions();
    this.connection = null;
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}
