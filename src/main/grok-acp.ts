import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
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
import {
  firstLookupResult,
  grokBinaryCandidates,
  grokCommand,
  pathLookupCommand,
} from './grok-platform';

const execFileAsync = promisify(execFile);
const CONNECTION_TIMEOUT_MS = 20_000;
const OPERATION_TIMEOUT_MS = 30_000;
const PERMISSION_TIMEOUT_MS = 10 * 60_000;
const SHUTDOWN_GRACE_MS = 1_500;

type PermissionResolver = {
  sessionId: string;
  allowedOptionIds: ReadonlySet<string>;
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
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      timeout: 5_000,
      windowsHide: true,
    }).catch(() => child.kill());
    return;
  }
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await delay(500);
  try {
    process.kill(-child.pid, 0);
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The process group exited during the grace period.
  }
}

export function permissionOutcome(
  allowedOptionIds: ReadonlySet<string>,
  resolution: PermissionResolution,
): acp.RequestPermissionResponse {
  if (resolution.cancelled || !resolution.optionId || !allowedOptionIds.has(resolution.optionId)) {
    return { outcome: { outcome: 'cancelled' } };
  }
  return { outcome: { outcome: 'selected', optionId: resolution.optionId } };
}

export async function resolveGrokBinary(): Promise<string | null> {
  const candidates = grokBinaryCandidates(process.platform, homedir(), process.env.GROK_BINARY);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  try {
    const lookup = pathLookupCommand(process.platform);
    const { stdout } = await execFileAsync(lookup.file, lookup.args, {
      timeout: 3_000,
      encoding: 'utf8',
      windowsHide: true,
    });
    const discovered = firstLookupResult(stdout);
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
    const command = grokCommand(binaryPath, ['--version'], process.platform);
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      timeout: 5_000,
      encoding: 'utf8',
      windowsHide: true,
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
  private sessionIds = new Set<string>();
  private lastStderr = '';
  private teardownPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private connectionGeneration = 0;
  private connectPromiseGeneration = -1;
  private readyGeneration = -1;

  constructor(private readonly clientVersion: string) {}

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
    if (this.shuttingDown) throw new Error('应用正在退出，无法启动新的 Grok 会话。');
    if (
      this.connection &&
      !this.connection.signal.aborted &&
      this.process &&
      !this.process.killed &&
      this.process.exitCode === null &&
      this.process.signalCode === null &&
      this.readyGeneration === this.connectionGeneration
    ) {
      return { status: 'ready', detail: '已连接本机 Grok Build' };
    }
    const generation = this.connectionGeneration;
    if (this.connectPromise && this.connectPromiseGeneration === generation) {
      return this.connectPromise;
    }

    const previousAttempt = this.connectPromise;
    const attempt = (async () => {
      if (previousAttempt) await previousAttempt.catch(() => undefined);
      if (this.disconnectPromise) await this.disconnectPromise;
      if (this.teardownPromise) await this.teardownPromise;
      if (this.process) await this.teardownCurrent(this.process);
      this.assertConnectionAttempt(generation);
      return this.startConnection(generation);
    })();
    this.connectPromise = attempt;
    this.connectPromiseGeneration = generation;
    void attempt.then(
      () => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      },
      () => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      },
    );
    return attempt;
  }

  private assertConnectionAttempt(generation: number): void {
    if (this.shuttingDown) throw new Error('应用正在退出，无法启动新的 Grok 会话。');
    if (generation !== this.connectionGeneration) {
      throw new Error('Grok 连接请求已取消。');
    }
  }

  private async startConnection(generation: number): Promise<GrokConnectionEvent> {
    this.assertConnectionAttempt(generation);
    this.connectionEvent({ status: 'checking', detail: '正在启动 Grok ACP…' });
    const binaryPath = await resolveGrokBinary();
    if (!binaryPath) {
      throw new Error('未找到 Grok Build。请先安装官方 grok CLI。');
    }
    this.assertConnectionAttempt(generation);

    const command = grokCommand(
      binaryPath,
      ['--no-auto-update', 'agent', 'stdio'],
      process.platform,
    );
    const child = spawn(command.file, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.process = child;
    this.lastStderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.lastStderr = `${this.lastStderr}${chunk}`.slice(-4_000);
    });
    child.once('exit', (code, signal) => {
      if (!this.clearCurrent(child)) return;
      void terminateProcessTree(child);
      const detail = this.lastStderr.trim() || `Grok ACP 已退出（code=${code}, signal=${signal}）`;
      if (!this.shuttingDown) {
        this.connectionEvent({ status: code === 0 ? 'offline' : 'error', detail });
      }
    });
    child.once('error', (error) => {
      if (!this.clearCurrent(child)) return;
      if (!this.shuttingDown) this.connectionEvent({ status: 'error', detail: error.message });
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
    void connection.closed.then(async () => {
      if (this.connection !== connection || this.process !== child) return;
      await this.teardownCurrent(child);
      if (!this.shuttingDown) {
        this.connectionEvent({ status: 'offline', detail: 'Grok ACP 通道已关闭。' });
      }
    });

    try {
      const initialized = await withTimeout(
        connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: 'orbit-workbench',
            title: '星轨工作台',
            version: this.clientVersion,
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

      this.assertConnectionAttempt(generation);
      if (this.connection !== connection || this.process !== child) {
        throw new Error('Grok 连接已失效。');
      }
      this.readyGeneration = generation;

      return this.connectionEvent({
        status: 'ready',
        detail: '已通过 ACP 连接本机 Grok Build',
        agentName: initialized.agentInfo?.title ?? initialized.agentInfo?.name,
        agentVersion: initialized.agentInfo?.version,
      });
    } catch (error) {
      await this.teardownCurrent(child);
      const detail = error instanceof Error ? error.message : '连接 Grok Build 失败。';
      if (!this.shuttingDown) this.connectionEvent({ status: 'error', detail });
      throw new Error(detail);
    }
  }

  async createSession(cwd: string): Promise<CreatedSession> {
    await this.connect();
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
    const response = await withTimeout(
      this.connection.newSession({ cwd, mcpServers: [] }),
      OPERATION_TIMEOUT_MS,
      '创建 Grok 会话超时。',
    );
    this.sessionIds.add(response.sessionId);
    return {
      sessionId: response.sessionId,
      currentModeId: response.modes?.currentModeId ?? null,
      availableModes: response.modes?.availableModes ?? [],
    };
  }

  async sendPrompt(sessionId: string, text: string): Promise<PromptResult> {
    await this.connect();
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
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
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (!this.connection) return;
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) this.resolvePermission({ requestId, cancelled: true });
    }
    await withTimeout(
      this.connection.cancel({ sessionId }),
      OPERATION_TIMEOUT_MS,
      '取消 Grok 会话超时。',
    );
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.connection) throw new Error('Grok ACP 尚未连接。');
    await withTimeout(
      this.connection.setSessionMode({ sessionId, modeId }),
      OPERATION_TIMEOUT_MS,
      '切换 Grok 会话模式超时。',
    );
  }

  resolvePermission(resolution: PermissionResolution): void {
    const pending = this.pendingPermissions.get(resolution.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(resolution.requestId);
    this.broadcast('grok:permission-cleared', { requestId: resolution.requestId });
    pending.resolve(permissionOutcome(pending.allowedOptionIds, resolution));
  }

  private requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ outcome: { outcome: 'cancelled' } });
        this.broadcast('grok:permission-cleared', { requestId });
      }, PERMISSION_TIMEOUT_MS);
      timer.unref();
      this.pendingPermissions.set(requestId, {
        sessionId: params.sessionId,
        allowedOptionIds: new Set(params.options.map((option) => option.optionId)),
        timer,
        resolve,
      });
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

  private clearCurrent(child: ChildProcessWithoutNullStreams): boolean {
    if (this.process !== child) return false;
    this.cancelAllPermissions();
    this.connection = null;
    this.process = null;
    this.readyGeneration = -1;
    this.sessionIds.clear();
    return true;
  }

  private async teardownCurrent(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (this.teardownPromise) {
      await this.teardownPromise;
      return;
    }
    if (!this.clearCurrent(child)) return;

    const teardown = (async () => {
      if (process.platform === 'win32') {
        await terminateProcessTree(child);
        return;
      }
      if (child.exitCode === null && child.signalCode === null) {
        if (!child.stdin.destroyed) child.stdin.end();
        await waitForExit(child, SHUTDOWN_GRACE_MS);
      }
      await terminateProcessTree(child);
    })();
    this.teardownPromise = teardown;
    try {
      await teardown;
    } finally {
      if (this.teardownPromise === teardown) this.teardownPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }
    this.connectionGeneration += 1;
    const operation = (async () => {
      const connection = this.connection;
      const activeSessions = [...this.sessionIds];
      this.cancelAllPermissions();

      if (connection && !connection.signal.aborted) {
        await Promise.allSettled(
          activeSessions.map((sessionId) =>
            withTimeout(connection.cancel({ sessionId }), 500, '取消会话超时。'),
          ),
        );
      }
      const child = this.process;
      if (child) await this.teardownCurrent(child);
      if (this.teardownPromise) await this.teardownPromise;
    })();
    this.disconnectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.disconnectPromise === operation) this.disconnectPromise = null;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.disconnect();
  }
}
