import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';
import * as acp from '@agentclientprotocol/sdk';
import type { WebContents } from 'electron';
import type {
  AcpSessionEvent,
  ConnectionIssueCode,
  CreatedSession,
  GrokConnectionEvent,
  GrokLogoutResult,
  GrokStatus,
  PermissionRequestEvent,
  PermissionResolution,
  PromptResult,
  UiAcpEvent,
} from '../shared/types';
import {
  sanitizeAcpSessionUpdate,
  sanitizeSessionConfigOptionsWithMetadata,
  sanitizeToolCall,
  sanitizeTurnUsage,
} from './acp-event-sanitizer';
import { sanitizeDiagnosticLine } from './grok-diagnostics';
import { buildGrokChildEnvironment } from './grok-environment';
import {
  firstLookupResult,
  grokBinaryCandidates,
  grokCommand,
  pathLookupCommand,
} from './grok-platform';
import { limitNdjsonFrameBytes } from './ndjson-frame-limit';
import { gracefullyShutdownProcess } from './process-lifecycle';
import { secureNdjsonStream } from './secure-ndjson-stream';
import { terminateWindowsProcessTree, windowsJobRunnerCommand } from './windows-process';

const execFileAsync = promisify(execFile);
const CONNECTION_TIMEOUT_MS = 20_000;
const OPERATION_TIMEOUT_MS = 30_000;
const LOGOUT_TIMEOUT_MS = 10_000;
const PERMISSION_TIMEOUT_MS = 10 * 60_000;
const SHUTDOWN_GRACE_MS = 1_500;
const PROMPT_IDLE_TIMEOUT_MS = 15 * 60_000;
const CANCEL_CONVERGENCE_TIMEOUT_MS = 5_000;
const CANCEL_WRITE_TIMEOUT_MS = 2_000;
const MAX_SESSION_ID_CHARACTERS = 256;
const MAX_STDERR_CHARACTERS = 16_000;
const MAX_EARLY_SESSION_IDS = 8;
const MAX_EARLY_EVENTS_PER_SESSION = 64;
const MAX_EARLY_EVENTS_TOTAL = 256;
const MAX_PENDING_PERMISSIONS_PER_TURN = 8;
const MAX_PENDING_PERMISSIONS_TOTAL = 32;
const MAX_VERSION_OUTPUT_BYTES = 16 * 1_024;
const MAX_PERMISSION_OPTIONS = 16;
const MAX_PERMISSION_OPTION_ID_CHARACTERS = 4_096;
const PERMISSION_OPTION_KINDS = new Set([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);

class OperationTimeoutError extends Error {}

type PermissionResolver = {
  sessionId: string;
  generation: number;
  turnToken: symbol;
  ownerWebContentsId: number;
  allowedOptionIds: ReadonlyMap<string, string>;
  timer: NodeJS.Timeout;
  resolve: (response: acp.RequestPermissionResponse) => void;
};

type SessionRegistration = {
  generation: number;
  cwd: string;
  ownerWebContentsId: number;
  modeIds: ReadonlySet<string>;
};

type ActiveTurn = {
  token: symbol;
  generation: number;
  phase: 'running' | 'awaiting_permission' | 'cancelling';
  idleTimer: NodeJS.Timeout | null;
  protocolSettled: Promise<void>;
  resolveProtocolSettled: () => void;
  aborted: Promise<never>;
  rejectAborted: (error: Error) => void;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs);
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

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function deferredError(): { promise: Promise<never>; reject: (error: Error) => void } {
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

function safeErrorDetail(error: unknown, fallback: string): string {
  return sanitizeDiagnosticLine(
    error instanceof Error ? error.message : fallback,
    homedir(),
    fallback,
    4_000,
  );
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validateAgentSessionId(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_SESSION_ID_CHARACTERS ||
    containsControlCharacters(value)
  ) {
    throw new Error('Grok 返回了无效的会话 ID。');
  }
  return value;
}

function validateModeId(value: string): string {
  if (value.length === 0 || value.length > 256 || containsControlCharacters(value)) {
    throw new Error('Grok 返回了无效的会话模式 ID。');
  }
  return value;
}

function sanitizeAgentModes(modes: acp.SessionModeState | null | undefined): {
  currentModeId: string | null;
  availableModes: CreatedSession['availableModes'];
  modeIds: ReadonlySet<string>;
} {
  if (!modes) return { currentModeId: null, availableModes: [], modeIds: new Set() };
  if (modes.availableModes.length > 64) throw new Error('Grok 返回的会话模式数量超过安全上限。');
  const modeIds = new Set<string>();
  const availableModes = modes.availableModes.map((mode) => {
    const id = validateModeId(mode.id);
    if (modeIds.has(id)) throw new Error('Grok 返回了重复的会话模式 ID。');
    modeIds.add(id);
    return {
      id,
      name: sanitizeDiagnosticLine(mode.name, homedir(), '未命名模式', 512),
      description:
        mode.description === undefined || mode.description === null
          ? mode.description
          : sanitizeDiagnosticLine(mode.description, homedir(), '', 1_000),
    };
  });
  const currentModeId = validateModeId(modes.currentModeId);
  if (!modeIds.has(currentModeId)) {
    throw new Error('Grok 返回的当前模式不在可用模式列表中。');
  }
  return { currentModeId, availableModes, modeIds };
}

function safeMetadata(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return sanitizeDiagnosticLine(value, homedir(), '', 512) || undefined;
}

function environmentHasValue(
  environment: Readonly<Record<string, unknown>>,
  requestedName: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalized = platform === 'win32' ? requestedName.toUpperCase() : requestedName;
  return Object.entries(environment).some(
    ([name, value]) =>
      (platform === 'win32' ? name.toUpperCase() : name) === normalized &&
      typeof value === 'string' &&
      value.trim().length > 0,
  );
}

function accountLabelFromLogoutOutput(output: string): string | null {
  const match = output.match(/was\s+signed\s+in\s+as\s+([^\r\n)]+)/iu);
  if (!match?.[1]) return null;
  const label = sanitizeDiagnosticLine(match[1].trim(), homedir(), '', 320);
  return label || null;
}

type CliLogoutVerification = {
  confirmed: boolean;
  changed: boolean;
  alreadyLoggedOut: boolean;
  accountLabel: string | null;
  detail: string;
};

async function verifyLogoutWithCli(binaryPath: string): Promise<CliLogoutVerification> {
  const command = grokCommand(binaryPath, ['--no-auto-update', 'logout'], process.platform);
  let output = '';
  let commandSucceeded = false;
  try {
    const result = await execFileAsync(command.file, command.args, {
      timeout: LOGOUT_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: MAX_VERSION_OUTPUT_BYTES,
      windowsHide: true,
      env: buildGrokChildEnvironment(process.env),
    });
    commandSucceeded = true;
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const details = error as { stdout?: unknown; stderr?: unknown };
    output = `${typeof details.stdout === 'string' ? details.stdout : ''}${
      typeof details.stderr === 'string' ? details.stderr : ''
    }`;
    if (!output.trim()) {
      return {
        confirmed: false,
        changed: false,
        alreadyLoggedOut: false,
        accountLabel: null,
        detail: safeErrorDetail(error, 'Grok CLI 注销命令执行失败。'),
      };
    }
  }

  const normalized = output.toLowerCase();
  const alreadyLoggedOut =
    normalized.includes('already logged out') ||
    normalized.includes('not logged in') ||
    normalized.includes('not signed in') ||
    normalized.includes('no active login') ||
    normalized.includes('未登录');
  const changed =
    !alreadyLoggedOut &&
    (normalized.includes('logged out') ||
      normalized.includes('signed out') ||
      normalized.includes('已退出'));
  const detail = sanitizeDiagnosticLine(
    output,
    homedir(),
    commandSucceeded ? 'Grok CLI 注销命令已完成。' : 'Grok CLI 注销命令未完成。',
    2_000,
  );
  if (!commandSucceeded) {
    return {
      confirmed: false,
      changed: false,
      alreadyLoggedOut: false,
      accountLabel: null,
      detail,
    };
  }

  return {
    confirmed: true,
    changed,
    alreadyLoggedOut,
    accountLabel: accountLabelFromLogoutOutput(output),
    detail,
  };
}

export function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === 'win32') {
    if (!(await terminateWindowsProcessTree(child))) {
      throw new Error('无法确认 Grok ACP Windows 进程已结束。');
    }
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
  allowedOptionIds: ReadonlyMap<string, string>,
  resolution: PermissionResolution,
): acp.RequestPermissionResponse {
  const originalOptionId = resolution.optionId
    ? allowedOptionIds.get(resolution.optionId)
    : undefined;
  if (resolution.cancelled || !originalOptionId) {
    return { outcome: { outcome: 'cancelled' } };
  }
  return { outcome: { outcome: 'selected', optionId: originalOptionId } };
}

export function sanitizePermissionOptions(options: readonly acp.PermissionOption[]): Array<{
  safeOptionId: string;
  originalOptionId: string;
  name: string;
  kind: acp.PermissionOptionKind;
}> | null {
  if (!Array.isArray(options) || options.length === 0 || options.length > MAX_PERMISSION_OPTIONS) {
    return null;
  }
  const originalIds = new Set<string>();
  const sanitized = [];
  for (const option of options) {
    if (
      !option ||
      typeof option.optionId !== 'string' ||
      typeof option.name !== 'string' ||
      typeof option.kind !== 'string' ||
      option.optionId.length === 0 ||
      option.optionId.length > MAX_PERMISSION_OPTION_ID_CHARACTERS ||
      containsControlCharacters(option.optionId) ||
      originalIds.has(option.optionId) ||
      !PERMISSION_OPTION_KINDS.has(option.kind)
    ) {
      return null;
    }
    originalIds.add(option.optionId);
    sanitized.push({
      safeOptionId: randomUUID(),
      originalOptionId: option.optionId,
      name: sanitizeDiagnosticLine(option.name, homedir(), '权限选项', 512),
      kind: option.kind,
    });
  }
  return sanitized;
}

export async function resolveGrokBinary(): Promise<string | null> {
  const candidates = grokBinaryCandidates(
    process.platform,
    homedir(),
    process.env.GROK_BINARY,
    process.env,
  );

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  try {
    const lookup = pathLookupCommand(process.platform);
    if (!lookup) return null;
    const { stdout } = await execFileAsync(lookup.file, lookup.args, {
      timeout: 3_000,
      encoding: 'utf8',
      windowsHide: true,
      env: buildGrokChildEnvironment(process.env),
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
      issueCode: 'binary_missing',
      retryable: true,
    };
  }

  try {
    const command = grokCommand(binaryPath, ['--version'], process.platform);
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      timeout: 5_000,
      encoding: 'utf8',
      maxBuffer: MAX_VERSION_OUTPUT_BYTES,
      windowsHide: true,
      env: buildGrokChildEnvironment(process.env),
    });
    const version = sanitizeDiagnosticLine(`${stdout}${stderr}`, homedir(), '已安装');
    return {
      status: 'detected',
      binaryPath,
      version,
      authenticated: null,
    };
  } catch (error) {
    return {
      status: 'error',
      binaryPath,
      version: null,
      authenticated: null,
      detail: safeErrorDetail(error, '无法读取 Grok Build 版本。'),
      issueCode: 'version_check_failed',
      retryable: true,
    };
  }
}

export function classifyConnectionIssue(detail: string): {
  issueCode: ConnectionIssueCode;
  retryable: boolean;
} {
  const normalized = detail.toLowerCase();
  if (normalized.includes('未找到 grok')) {
    return { issueCode: 'binary_missing', retryable: true };
  }
  if (
    normalized.includes('auth_required') ||
    normalized.includes('auth required') ||
    normalized.includes('authentication required') ||
    normalized.includes('需要登录') ||
    normalized.includes('尚未登录') ||
    normalized.includes('未登录')
  ) {
    return { issueCode: 'authentication_required', retryable: true };
  }
  if (normalized.includes('身份验证') || normalized.includes('authenticate')) {
    return {
      issueCode: normalized.includes('尚未支持')
        ? 'authentication_unsupported'
        : 'authentication_failed',
      retryable: true,
    };
  }
  if (normalized.includes('协议版本不兼容')) {
    return { issueCode: 'protocol_incompatible', retryable: false };
  }
  if (normalized.includes('无法解析的协议帧') || normalized.includes('协议帧')) {
    return { issueCode: 'protocol_invalid', retryable: true };
  }
  if (normalized.includes('超时')) {
    return { issueCode: 'timeout', retryable: true };
  }
  if (normalized.includes('通道') && normalized.includes('关闭')) {
    return { issueCode: 'channel_closed', retryable: true };
  }
  if (
    normalized.includes('子进程') ||
    normalized.includes('已退出') ||
    normalized.includes('spawn')
  ) {
    return { issueCode: 'process_failed', retryable: true };
  }
  return { issueCode: 'unknown', retryable: true };
}

export class GrokAcpManager {
  private process: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private connectPromise: Promise<GrokConnectionEvent> | null = null;
  private webContents = new Map<number, WebContents>();
  private pendingPermissions = new Map<string, PermissionResolver>();
  private sessions = new Map<string, SessionRegistration>();
  private earlySessionEvents = new Map<string, UiAcpEvent[]>();
  private activeTurns = new Map<string, ActiveTurn>();
  private lastStderr = '';
  private teardownPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private logoutPromise: Promise<GrokLogoutResult> | null = null;
  private shuttingDown = false;
  private connectionGeneration = 0;
  private connectionIntentGeneration = 0;
  private connectPromiseGeneration = -1;
  private readyGeneration = -1;
  private readyEvent: GrokConnectionEvent | null = null;
  private binaryPath: string | null = null;
  private authenticated: boolean | null = null;
  private authMethod: string | null = null;
  private logoutSupported = false;

  constructor(
    private readonly clientVersion: string,
    private readonly windowsJobRunnerPath: string | null = null,
  ) {}

  private runBackground(operation: Promise<void>, fallback: string): void {
    void operation.catch((error) => {
      if (this.shuttingDown) return;
      const detail = safeErrorDetail(error, fallback);
      this.connectionEvent({ status: 'error', detail, ...classifyConnectionIssue(detail) });
    });
  }

  registerWebContents(contents: WebContents): () => void {
    this.webContents.set(contents.id, contents);
    return () => {
      this.webContents.delete(contents.id);
      this.releaseOwnerSessions(contents.id);
    };
  }

  releaseSessionsForWebContents(ownerWebContentsId: number): void {
    this.releaseOwnerSessions(ownerWebContentsId);
  }

  private releaseOwnerSessions(ownerWebContentsId: number): void {
    const ownedSessionIds = [...this.sessions]
      .filter(([, registration]) => registration.ownerWebContentsId === ownerWebContentsId)
      .map(([sessionId]) => sessionId);
    if (ownedSessionIds.length === 0) return;
    const owned = new Set(ownedSessionIds);
    const hasActiveWork =
      ownedSessionIds.some((sessionId) => this.activeTurns.has(sessionId)) ||
      [...this.pendingPermissions.values()].some((pending) => owned.has(pending.sessionId));
    if (hasActiveWork) {
      this.runBackground(
        this.invalidateConnection('发起任务的窗口已关闭，已停止本地代理以取消后台操作。'),
        '关闭窗口后清理本地代理失败。',
      );
      return;
    }
    for (const sessionId of ownedSessionIds) this.sessions.delete(sessionId);
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const contents of this.webContents.values()) {
      if (!contents.isDestroyed()) contents.send(channel, payload);
    }
  }

  private sendToWebContents(webContentsId: number, channel: string, payload: unknown): void {
    const contents = this.webContents.get(webContentsId);
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  private emitSessionEvent(sessionId: string, event: UiAcpEvent): void {
    const registration = this.sessions.get(sessionId);
    if (!registration || registration.generation !== this.connectionGeneration) return;
    const payload: AcpSessionEvent = { sessionId, event };
    this.sendToWebContents(registration.ownerWebContentsId, 'grok:session-update', payload);
  }

  private connectionEvent(event: GrokConnectionEvent): GrokConnectionEvent {
    this.broadcast('grok:connection-event', event);
    return event;
  }

  async connect(): Promise<GrokConnectionEvent> {
    if (this.shuttingDown) throw new Error('应用正在退出，无法启动新的 Grok 会话。');
    if (this.logoutPromise) throw new Error('正在退出 Grok 账号，已取消连接请求。');
    const intentGeneration = this.connectionIntentGeneration;
    if (
      this.connection &&
      !this.connection.signal.aborted &&
      this.process &&
      !this.process.killed &&
      this.process.exitCode === null &&
      this.process.signalCode === null &&
      this.readyGeneration === this.connectionGeneration
    ) {
      return (
        this.readyEvent ?? {
          status: 'ready',
          detail: '已建立 Grok ACP 连接。',
          authenticated: this.authenticated,
          authMethod: this.authMethod,
          logoutSupported: this.logoutSupported,
        }
      );
    }
    let generation = this.connectionGeneration;
    if (this.connectPromise && this.connectPromiseGeneration === generation) {
      return this.connectPromise;
    }
    if (this.process) {
      this.connectionGeneration += 1;
      generation = this.connectionGeneration;
    }

    const previousAttempt = this.connectPromise;
    const attempt = (async () => {
      if (previousAttempt) await previousAttempt.catch(() => undefined);
      if (this.disconnectPromise) await this.disconnectPromise;
      if (this.teardownPromise) await this.teardownPromise;
      if (this.process) await this.teardownCurrent(this.process);
      this.assertConnectionAttempt(generation, intentGeneration);
      return this.startConnection(generation, intentGeneration);
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

  async reconnect(): Promise<GrokConnectionEvent> {
    if (this.shuttingDown) throw new Error('应用正在退出，无法重新连接 Grok。');
    if (this.logoutPromise) throw new Error('正在退出 Grok 账号，已取消重新连接请求。');
    const intentGeneration = this.connectionIntentGeneration;
    await this.disconnectCurrent();
    this.assertConnectionIntent(intentGeneration);
    if (this.process || this.teardownPromise) {
      throw new Error('旧的 Grok ACP 进程尚未确认结束，已阻止启动第二个本地代理。');
    }
    return this.connect();
  }

  private assertConnectionIntent(intentGeneration: number): void {
    if (intentGeneration !== this.connectionIntentGeneration || this.logoutPromise) {
      throw new Error('Grok 连接请求已被后发的断开或退出账号操作取消。');
    }
  }

  private assertConnectionAttempt(generation: number, intentGeneration: number): void {
    if (this.shuttingDown) throw new Error('应用正在退出，无法启动新的 Grok 会话。');
    this.assertConnectionIntent(intentGeneration);
    if (generation !== this.connectionGeneration) {
      throw new Error('Grok 连接请求已取消。');
    }
  }

  private async startConnection(
    generation: number,
    intentGeneration: number,
  ): Promise<GrokConnectionEvent> {
    this.assertConnectionAttempt(generation, intentGeneration);
    this.connectionEvent({ status: 'connecting', detail: '正在启动 Grok ACP…' });
    const binaryPath = await resolveGrokBinary();
    if (!binaryPath) {
      throw new Error('未找到 Grok Build。请先安装官方 grok CLI。');
    }
    this.assertConnectionAttempt(generation, intentGeneration);
    this.binaryPath = binaryPath;

    const directCommand = grokCommand(
      binaryPath,
      ['--no-auto-update', 'agent', 'stdio'],
      process.platform,
    );
    let command = directCommand;
    if (process.platform === 'win32') {
      if (!this.windowsJobRunnerPath || !(await isExecutable(this.windowsJobRunnerPath))) {
        throw new Error('Windows 进程隔离组件缺失或无法读取，请重新安装星轨工作台。');
      }
      command = windowsJobRunnerCommand(this.windowsJobRunnerPath, process.pid, directCommand);
    }
    const child = spawn(command.file, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildGrokChildEnvironment(process.env),
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.process = child;
    this.lastStderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.lastStderr = `${this.lastStderr}${chunk}`.slice(-MAX_STDERR_CHARACTERS);
    });
    child.once('exit', (code, signal) => {
      const detail = sanitizeDiagnosticLine(
        this.lastStderr,
        homedir(),
        `Grok ACP 已退出（code=${code}, signal=${signal}）`,
        4_000,
      );
      this.runBackground(
        this.handleUnexpectedTermination(child, code === 0 ? 'offline' : 'error', detail),
        'Grok ACP 退出后清理失败。',
      );
    });
    child.once('error', (error) => {
      this.runBackground(
        this.handleUnexpectedTermination(
          child,
          'error',
          safeErrorDetail(error, 'Grok ACP 子进程启动失败。'),
        ),
        'Grok ACP 启动失败后清理异常。',
      );
    });

    try {
      const input = Writable.toWeb(child.stdin);
      const output = limitNdjsonFrameBytes(
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const stream = secureNdjsonStream(input, output);

      const client: acp.Client = {
        requestPermission: (params) => this.requestPermission(params, generation),
        sessionUpdate: (params) => {
          const registration = this.sessions.get(params.sessionId);
          if (generation !== this.connectionGeneration) return;
          const event = sanitizeAcpSessionUpdate(params.update);
          if (!registration) {
            if (event) this.bufferEarlySessionEvent(params.sessionId, event, generation);
            return;
          }
          if (registration.generation !== generation) return;
          this.touchTurn(params.sessionId);
          if (event?.type === 'mode.confirmed' && !registration.modeIds.has(event.currentModeId)) {
            this.runBackground(
              this.invalidateConnection(
                'Grok 报告了当前会话未声明的模式，已停止本地代理以避免状态失真。',
              ),
              'Grok 模式异常后清理本地代理失败。',
            );
            return;
          }
          if (event) this.emitSessionEvent(params.sessionId, event);
        },
      };

      const connection = new acp.ClientSideConnection(() => client, stream);
      this.connection = connection;
      this.runBackground(
        connection.closed.then(
          async () => {
            if (this.connection !== connection || this.process !== child) return;
            await this.handleUnexpectedTermination(child, 'offline', 'Grok ACP 通道已关闭。');
          },
          async (error) => {
            if (this.connection !== connection || this.process !== child) return;
            await this.handleUnexpectedTermination(
              child,
              'error',
              safeErrorDetail(error, 'Grok ACP 通道异常关闭。'),
            );
          },
        ),
        'Grok ACP 通道关闭后清理失败。',
      );

      const initialized = await withTimeout(
        connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { plan: {} },
          clientInfo: {
            name: 'orbit-workbench',
            title: '星轨工作台',
            version: this.clientVersion,
          },
        }),
        CONNECTION_TIMEOUT_MS,
        '连接 Grok ACP 超时。',
      );

      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw new Error(
          `Grok ACP 协议版本不兼容（客户端 ${acp.PROTOCOL_VERSION}，代理 ${initialized.protocolVersion}）。`,
        );
      }

      const authMethods = initialized.authMethods ?? [];
      let authenticated: boolean | null = authMethods.length > 0 ? false : null;
      let selectedAuthMethod: acp.AuthMethod | null = null;
      if (authMethods.length > 0) {
        const hasXaiApiKey = environmentHasValue(process.env, 'XAI_API_KEY');
        const candidates = [
          authMethods.find((method) => method.id === 'cached_token'),
          hasXaiApiKey ? authMethods.find((method) => method.id === 'xai.api_key') : undefined,
          authMethods.find((method) => method.id.includes('cached')),
        ].filter(
          (method, index, all): method is acp.AuthMethod =>
            Boolean(method) && all.findIndex((item) => item?.id === method?.id) === index,
        );
        if (candidates.length === 0) {
          if (!hasXaiApiKey && authMethods.some((method) => method.id === 'xai.api_key')) {
            throw new Error('Grok 需要登录或 XAI_API_KEY，当前未检测到可用的身份凭据。');
          }
          throw new Error('Grok 需要当前客户端尚未支持的身份验证方式。');
        }
        let lastAuthError: unknown;
        for (const method of candidates) {
          try {
            await withTimeout(
              connection.authenticate({
                methodId: method.id,
                _meta: { headless: true },
              }),
              CONNECTION_TIMEOUT_MS,
              'Grok 身份验证超时。',
            );
            authenticated = true;
            selectedAuthMethod = method;
            break;
          } catch (error) {
            lastAuthError = error;
          }
        }
        if (!authenticated) {
          throw new Error(safeErrorDetail(lastAuthError, 'Grok 身份验证失败。'));
        }
      }

      this.assertConnectionAttempt(generation, intentGeneration);
      if (this.connection !== connection || this.process !== child) {
        throw new Error('Grok 连接已失效。');
      }
      this.readyGeneration = generation;
      this.authenticated = authenticated;
      this.authMethod = selectedAuthMethod
        ? (safeMetadata(selectedAuthMethod.name) ?? safeMetadata(selectedAuthMethod.id) ?? null)
        : null;
      this.logoutSupported = initialized.agentCapabilities?.auth?.logout != null;
      const readyEvent: GrokConnectionEvent = {
        status: 'ready',
        detail:
          authenticated === true
            ? `已通过${this.authMethod ? `“${this.authMethod}”` : '代理声明的方式'}完成 ACP 身份验证并连接本机 Grok Build。`
            : '已建立 Grok ACP 连接；代理未声明需要由客户端执行的身份验证步骤。',
        agentName: safeMetadata(initialized.agentInfo?.title ?? initialized.agentInfo?.name),
        agentVersion: safeMetadata(initialized.agentInfo?.version),
        authenticated,
        authMethod: this.authMethod,
        logoutSupported: this.logoutSupported,
      };
      this.readyEvent = readyEvent;
      return this.connectionEvent(readyEvent);
    } catch (error) {
      const ownsChild = this.process === child;
      if (ownsChild) this.connectionGeneration += 1;
      const detail = safeErrorDetail(error, '连接 Grok Build 失败。');
      await this.teardownCurrent(child, detail);
      if (ownsChild && !this.shuttingDown) {
        this.connectionEvent({ status: 'error', detail, ...classifyConnectionIssue(detail) });
      }
      throw new Error(detail);
    }
  }

  private async handleUnexpectedTermination(
    child: ChildProcessWithoutNullStreams,
    status: 'offline' | 'error',
    detail: string,
  ): Promise<void> {
    if (this.process !== child) return;
    this.connectionGeneration += 1;
    await this.teardownCurrent(child, detail);
    if (!this.shuttingDown) {
      this.connectionEvent({ status, detail, ...classifyConnectionIssue(detail) });
    }
  }

  private assertRegisteredWebContents(ownerWebContentsId: number): void {
    const contents = this.webContents.get(ownerWebContentsId);
    if (!contents || contents.isDestroyed()) {
      throw new Error('发起请求的窗口已经关闭。');
    }
  }

  private assertOwnedSession(sessionId: string, ownerWebContentsId: number): SessionRegistration {
    const registration = this.sessions.get(sessionId);
    if (!registration || registration.generation !== this.connectionGeneration) {
      throw new Error('Grok 会话已失效，请新建任务。');
    }
    if (registration.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('已拒绝访问其他窗口创建的 Grok 会话。');
    }
    return registration;
  }

  private async invalidateConnection(detail: string): Promise<void> {
    const hadConnection = Boolean(this.connection || this.process || this.sessions.size);
    this.connectionGeneration += 1;
    const child = this.process;
    if (child) await this.teardownCurrent(child, detail);
    else {
      this.cancelAllPermissions();
      this.sessions.clear();
      this.earlySessionEvents.clear();
      for (const turn of this.activeTurns.values()) {
        if (turn.idleTimer) clearTimeout(turn.idleTimer);
        turn.rejectAborted(new Error(detail));
      }
    }
    if (hadConnection && !this.shuttingDown) {
      this.connectionEvent({ status: 'error', detail, ...classifyConnectionIssue(detail) });
    }
  }

  private async runStateChangingOperation<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    try {
      return await withTimeout(operation, timeoutMs, timeoutMessage);
    } catch (error) {
      if (error instanceof OperationTimeoutError) await this.invalidateConnection(error.message);
      throw error;
    }
  }

  private bufferEarlySessionEvent(
    rawSessionId: string,
    event: UiAcpEvent,
    generation: number,
  ): void {
    if (generation !== this.connectionGeneration) return;
    let sessionId: string;
    try {
      sessionId = validateAgentSessionId(rawSessionId);
    } catch {
      return;
    }
    const existing = this.earlySessionEvents.get(sessionId);
    if (!existing && this.earlySessionEvents.size >= MAX_EARLY_SESSION_IDS) {
      this.runBackground(
        this.invalidateConnection('Grok 在会话创建期间发送了过多未归属事件，已重启本地代理。'),
        '清理事件溢出的本地代理失败。',
      );
      return;
    }
    const total = [...this.earlySessionEvents.values()].reduce(
      (count, events) => count + events.length,
      0,
    );
    if (total >= MAX_EARLY_EVENTS_TOTAL) {
      this.runBackground(
        this.invalidateConnection('Grok 在会话创建期间发送了过多事件，已重启本地代理。'),
        '清理事件溢出的本地代理失败。',
      );
      return;
    }
    const events = existing ?? [];
    if (events.length >= MAX_EARLY_EVENTS_PER_SESSION) {
      this.runBackground(
        this.invalidateConnection('Grok 会话创建事件超过安全上限，已重启本地代理。'),
        '清理事件溢出的本地代理失败。',
      );
      return;
    }
    events.push(event);
    if (!existing) this.earlySessionEvents.set(sessionId, events);
  }

  private beginTurn(sessionId: string, generation: number): ActiveTurn {
    if (this.activeTurns.has(sessionId)) throw new Error('此 Grok 会话已有任务正在执行。');
    const settled = deferredVoid();
    const aborted = deferredError();
    const turn: ActiveTurn = {
      token: Symbol(sessionId),
      generation,
      phase: 'running',
      idleTimer: null,
      protocolSettled: settled.promise,
      resolveProtocolSettled: settled.resolve,
      aborted: aborted.promise,
      rejectAborted: aborted.reject,
    };
    this.activeTurns.set(sessionId, turn);
    this.armTurnWatchdog(sessionId, turn);
    return turn;
  }

  private armTurnWatchdog(sessionId: string, turn: ActiveTurn): void {
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    if (turn.phase !== 'running') {
      turn.idleTimer = null;
      return;
    }
    turn.idleTimer = setTimeout(() => {
      turn.idleTimer = null;
      this.runBackground(
        this.handleIdleTurn(sessionId, turn),
        'Grok 空闲 watchdog 清理本地代理失败。',
      );
    }, PROMPT_IDLE_TIMEOUT_MS);
    turn.idleTimer.unref();
  }

  private touchTurn(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId);
    if (turn?.phase === 'running') this.armTurnWatchdog(sessionId, turn);
  }

  private pauseTurnForPermission(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId);
    if (!turn || turn.phase === 'cancelling') return;
    turn.phase = 'awaiting_permission';
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    turn.idleTimer = null;
  }

  private resumeTurnAfterPermission(sessionId: string, turnToken: symbol): void {
    const turn = this.activeTurns.get(sessionId);
    if (!turn || turn.token !== turnToken || turn.phase === 'cancelling') return;
    const stillWaiting = [...this.pendingPermissions.values()].some(
      (pending) => pending.sessionId === sessionId && pending.turnToken === turnToken,
    );
    if (stillWaiting) return;
    turn.phase = 'running';
    this.armTurnWatchdog(sessionId, turn);
  }

  private cancelPermissionsForTurn(sessionId: string, turnToken: symbol): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId && pending.turnToken === turnToken) {
        this.resolvePermission({ requestId, cancelled: true });
      }
    }
  }

  private async handleIdleTurn(sessionId: string, turn: ActiveTurn): Promise<void> {
    if (this.activeTurns.get(sessionId)?.token !== turn.token || turn.phase !== 'running') return;
    turn.phase = 'cancelling';
    const connection = this.connection;
    if (!connection || turn.generation !== this.connectionGeneration) return;
    try {
      await withTimeout(
        connection.cancel({ sessionId }),
        CANCEL_WRITE_TIMEOUT_MS,
        'Grok 无响应，取消请求写入超时。',
      );
    } catch (error) {
      await this.invalidateConnection(safeErrorDetail(error, 'Grok 无响应，无法提交取消请求。'));
      return;
    }
    if (!(await settlesWithin(turn.protocolSettled, CANCEL_CONVERGENCE_TIMEOUT_MS))) {
      await this.invalidateConnection('Grok 已长时间无事件且取消后仍未收敛，已重启本地代理。');
    }
  }

  async createSession(cwd: string, ownerWebContentsId: number): Promise<CreatedSession> {
    this.assertRegisteredWebContents(ownerWebContentsId);
    await this.connect();
    const connection = this.connection;
    const generation = this.connectionGeneration;
    if (!connection) throw new Error('Grok ACP 尚未连接。');
    let response: acp.NewSessionResponse;
    try {
      response = await this.runStateChangingOperation(
        connection.newSession({ cwd, mcpServers: [] }),
        OPERATION_TIMEOUT_MS,
        '创建 Grok 会话超时。',
      );
    } catch (error) {
      throw new Error(safeErrorDetail(error, '创建 Grok 会话失败。'));
    }
    if (
      this.connection !== connection ||
      generation !== this.connectionGeneration ||
      connection.signal.aborted
    ) {
      throw new Error('创建完成前 Grok 连接已变化，请重新新建任务。');
    }
    try {
      this.assertRegisteredWebContents(ownerWebContentsId);
    } catch (error) {
      await this.invalidateConnection('创建会话时发起窗口已关闭，已清理孤立的代理会话。');
      throw error;
    }
    let sessionId: string;
    try {
      sessionId = validateAgentSessionId(response.sessionId);
      if (this.sessions.has(sessionId)) throw new Error('Grok 返回了重复的会话 ID。');
    } catch (error) {
      const detail = safeErrorDetail(error, 'Grok 返回了无效的会话 ID。');
      await this.invalidateConnection(detail);
      throw new Error(detail);
    }
    let modeState: ReturnType<typeof sanitizeAgentModes>;
    try {
      modeState = sanitizeAgentModes(response.modes);
    } catch (error) {
      const detail = safeErrorDetail(error, 'Grok 返回了无效的会话模式。');
      await this.invalidateConnection(detail);
      throw new Error(detail);
    }
    this.sessions.set(sessionId, {
      generation,
      cwd,
      ownerWebContentsId,
      modeIds: modeState.modeIds,
    });
    const earlyEvents = this.earlySessionEvents.get(sessionId) ?? [];
    this.earlySessionEvents.delete(sessionId);
    if (
      earlyEvents.some(
        (event) => event.type === 'mode.confirmed' && !modeState.modeIds.has(event.currentModeId),
      )
    ) {
      const detail = 'Grok 在会话创建期间报告了未声明的模式，已停止本地代理。';
      await this.invalidateConnection(detail);
      throw new Error(detail);
    }
    let currentModeId = modeState.currentModeId;
    for (const event of earlyEvents) {
      if (event.type === 'mode.confirmed') currentModeId = event.currentModeId;
      this.emitSessionEvent(sessionId, event);
    }
    const config = sanitizeSessionConfigOptionsWithMetadata(response.configOptions);
    return {
      sessionId,
      currentModeId,
      availableModes: modeState.availableModes,
      configOptions: config.items,
      configOptionsTruncated: config.truncated,
    };
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    ownerWebContentsId: number,
  ): Promise<PromptResult> {
    this.assertOwnedSession(sessionId, ownerWebContentsId);
    await this.connect();
    const connection = this.connection;
    if (!connection) throw new Error('Grok ACP 尚未连接。');
    const registration = this.assertOwnedSession(sessionId, ownerWebContentsId);
    const turn = this.beginTurn(sessionId, registration.generation);
    let operation: Promise<acp.PromptResponse>;
    try {
      operation = connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });
    } catch (error) {
      turn.resolveProtocolSettled();
      this.activeTurns.delete(sessionId);
      throw new Error(safeErrorDetail(error, '无法启动 Grok 任务。'));
    }
    void operation.then(turn.resolveProtocolSettled, turn.resolveProtocolSettled);
    try {
      const response = await Promise.race([operation, turn.aborted]);
      if (this.connection !== connection || registration.generation !== this.connectionGeneration) {
        throw new Error('Grok 会话在任务结束前已失效。');
      }
      const usage = sanitizeTurnUsage(response.usage);
      this.emitSessionEvent(sessionId, {
        type: 'turn.completed',
        stopReason: response.stopReason,
        usage,
      });
      return { sessionId, stopReason: response.stopReason, usage };
    } catch (error) {
      throw new Error(safeErrorDetail(error, 'Grok 任务执行失败。'));
    } finally {
      if (turn.idleTimer) clearTimeout(turn.idleTimer);
      turn.resolveProtocolSettled();
      if (this.activeTurns.get(sessionId)?.token === turn.token) {
        this.activeTurns.delete(sessionId);
        this.cancelPermissionsForTurn(sessionId, turn.token);
      }
    }
  }

  async cancelSession(sessionId: string, ownerWebContentsId: number): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error('Grok ACP 尚未连接。');
    this.assertOwnedSession(sessionId, ownerWebContentsId);
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) this.resolvePermission({ requestId, cancelled: true });
    }
    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;
    turn.phase = 'cancelling';
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    turn.idleTimer = null;
    try {
      await withTimeout(
        connection.cancel({ sessionId }),
        CANCEL_WRITE_TIMEOUT_MS,
        '取消 Grok 会话写入超时。',
      );
    } catch (error) {
      const detail = safeErrorDetail(error, '无法提交 Grok 取消请求。');
      await this.invalidateConnection(detail);
      throw new Error(detail);
    }
    if (!(await settlesWithin(turn.protocolSettled, CANCEL_CONVERGENCE_TIMEOUT_MS))) {
      const detail = 'Grok 未在取消后及时停止，已强制重启本地代理。';
      await this.invalidateConnection(detail);
      throw new Error(detail);
    }
  }

  async setSessionMode(
    sessionId: string,
    modeId: string,
    ownerWebContentsId: number,
  ): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error('Grok ACP 尚未连接。');
    const registration = this.assertOwnedSession(sessionId, ownerWebContentsId);
    if (this.activeTurns.has(sessionId)) {
      throw new Error('Grok 正在执行任务，模式只能在下一轮开始前切换。');
    }
    if (!registration.modeIds.has(modeId)) throw new Error('Grok 会话不支持所选模式。');
    try {
      await this.runStateChangingOperation(
        connection.setSessionMode({ sessionId, modeId }),
        OPERATION_TIMEOUT_MS,
        '切换 Grok 会话模式超时。',
      );
    } catch (error) {
      throw new Error(safeErrorDetail(error, '切换 Grok 会话模式失败。'));
    }
    if (
      this.connection !== connection ||
      registration.generation !== this.connectionGeneration ||
      connection.signal.aborted
    ) {
      throw new Error('模式切换完成前 Grok 连接已失效。');
    }
  }

  resolvePermission(resolution: PermissionResolution, ownerWebContentsId?: number): void {
    const pending = this.pendingPermissions.get(resolution.requestId);
    if (!pending) return;
    if (ownerWebContentsId !== undefined && pending.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('已拒绝处理其他窗口的权限请求。');
    }
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(resolution.requestId);
    this.sendToWebContents(pending.ownerWebContentsId, 'grok:permission-cleared', {
      requestId: resolution.requestId,
    });
    const registration = this.sessions.get(pending.sessionId);
    const isCurrent =
      pending.generation === this.connectionGeneration &&
      registration?.generation === pending.generation;
    pending.resolve(
      isCurrent
        ? permissionOutcome(pending.allowedOptionIds, resolution)
        : { outcome: { outcome: 'cancelled' } },
    );
    if (isCurrent) this.resumeTurnAfterPermission(pending.sessionId, pending.turnToken);
  }

  private requestPermission(
    params: acp.RequestPermissionRequest,
    callbackGeneration: number,
  ): Promise<acp.RequestPermissionResponse> {
    const registration = this.sessions.get(params.sessionId);
    const turn = this.activeTurns.get(params.sessionId);
    if (
      callbackGeneration !== this.connectionGeneration ||
      !registration ||
      registration.generation !== callbackGeneration ||
      !turn ||
      turn.generation !== callbackGeneration ||
      turn.phase === 'cancelling'
    ) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    }
    const pendingForTurn = [...this.pendingPermissions.values()].filter(
      (pending) => pending.sessionId === params.sessionId && pending.turnToken === turn.token,
    ).length;
    if (
      pendingForTurn >= MAX_PENDING_PERMISSIONS_PER_TURN ||
      this.pendingPermissions.size >= MAX_PENDING_PERMISSIONS_TOTAL
    ) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    }
    const visibleOptions = sanitizePermissionOptions(params.options);
    if (!visibleOptions) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pauseTurnForPermission(params.sessionId);
    const requestId = randomUUID();
    const expiresAt = Date.now() + PERMISSION_TIMEOUT_MS;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ outcome: { outcome: 'cancelled' } });
        this.sendToWebContents(registration.ownerWebContentsId, 'grok:permission-cleared', {
          requestId,
        });
        this.resumeTurnAfterPermission(params.sessionId, turn.token);
      }, PERMISSION_TIMEOUT_MS);
      timer.unref();
      this.pendingPermissions.set(requestId, {
        sessionId: params.sessionId,
        generation: registration.generation,
        turnToken: turn.token,
        ownerWebContentsId: registration.ownerWebContentsId,
        allowedOptionIds: new Map(
          visibleOptions.map((option) => [option.safeOptionId, option.originalOptionId]),
        ),
        timer,
        resolve,
      });
      const event: PermissionRequestEvent = {
        requestId,
        sessionId: params.sessionId,
        workspacePath: registration.cwd,
        expiresAt,
        toolCall: sanitizeToolCall(params.toolCall),
        options: visibleOptions.map((option) => ({
          optionId: option.safeOptionId,
          name: option.name,
          kind: option.kind,
        })),
      };
      this.sendToWebContents(registration.ownerWebContentsId, 'grok:permission-request', event);
    });
  }

  private cancelAllPermissions(): void {
    for (const [requestId] of this.pendingPermissions) {
      this.resolvePermission({ requestId, cancelled: true });
    }
  }

  private clearCurrent(
    child: ChildProcessWithoutNullStreams,
    abortDetail = 'Grok ACP 连接已关闭。',
  ): boolean {
    if (this.process !== child) return false;
    this.cancelAllPermissions();
    this.connection = null;
    this.process = null;
    this.readyGeneration = -1;
    this.readyEvent = null;
    this.authenticated = null;
    this.authMethod = null;
    this.logoutSupported = false;
    this.sessions.clear();
    this.earlySessionEvents.clear();
    for (const turn of this.activeTurns.values()) {
      if (turn.idleTimer) clearTimeout(turn.idleTimer);
      turn.idleTimer = null;
      turn.rejectAborted(new Error(abortDetail));
    }
    return true;
  }

  private async teardownCurrent(
    child: ChildProcessWithoutNullStreams,
    abortDetail = 'Grok ACP 连接已关闭。',
  ): Promise<void> {
    if (this.teardownPromise) {
      await this.teardownPromise;
      return;
    }
    if (!this.clearCurrent(child, abortDetail)) return;

    const teardown = gracefullyShutdownProcess(child, {
      cleanupAfterExit: process.platform === 'win32' ? undefined : terminateProcessTree,
      forceTerminate: terminateProcessTree,
      graceTimeoutMs: SHUTDOWN_GRACE_MS,
    });
    this.teardownPromise = teardown;
    let teardownFailed = false;
    let teardownError: unknown;
    try {
      await teardown;
    } catch (error) {
      teardownFailed = true;
      teardownError = error;
    } finally {
      if (this.teardownPromise === teardown) this.teardownPromise = null;
    }
    if (teardownFailed) {
      if (child.exitCode === null && child.signalCode === null && this.process === null) {
        // Keep the handle so a retry attempts teardown again instead of
        // starting a second local agent beside an unconfirmed orphan.
        this.process = child;
      }
      throw teardownError;
    }
  }

  async logout(): Promise<GrokLogoutResult> {
    if (this.logoutPromise) return this.logoutPromise;
    this.connectionIntentGeneration += 1;
    const operation = this.performLogout();
    this.logoutPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.logoutPromise === operation) this.logoutPromise = null;
    }
  }

  private async performLogout(): Promise<GrokLogoutResult> {
    const binaryPath = this.binaryPath ?? (await resolveGrokBinary());
    const connection = this.connection;
    const hadAuthenticatedConnection = this.authenticated === true;
    const advertisedLogout = this.logoutSupported;
    let acpLogoutSucceeded = false;
    let acpLogoutError: string | null = null;

    if (advertisedLogout && connection && !connection.signal.aborted) {
      try {
        await withTimeout(connection.logout({}), LOGOUT_TIMEOUT_MS, 'Grok ACP 注销请求超时。');
        acpLogoutSucceeded = true;
      } catch (error) {
        acpLogoutError = safeErrorDetail(error, 'Grok ACP 注销失败。');
      }
    }

    try {
      await this.disconnectCurrent();
    } catch (error) {
      const detail = `无法确认旧的 Grok ACP 进程已结束，已停止注销流程以避免凭据被后台进程重新写入：${safeErrorDetail(
        error,
        '本地代理清理失败。',
      )}`;
      const result: GrokLogoutResult = {
        confirmed: false,
        status: 'failed',
        accountLabel: null,
        detail,
      };
      if (!this.shuttingDown) {
        this.connectionEvent({
          status: 'error',
          detail,
          authenticated: null,
          authMethod: null,
          logoutSupported: false,
          issueCode: 'process_failed',
          retryable: true,
        });
      }
      return result;
    }

    let result: GrokLogoutResult;
    if (!binaryPath) {
      result = acpLogoutSucceeded
        ? {
            confirmed: true,
            status: 'logged_out',
            accountLabel: null,
            detail: 'ACP 已确认退出登录并停止本地代理；未找到 CLI，无法进行第二次命令行复核。',
          }
        : {
            confirmed: false,
            status: 'failed',
            accountLabel: null,
            detail: '未找到 Grok Build CLI，无法确认登录状态。',
          };
    } else {
      const cli = await verifyLogoutWithCli(binaryPath);
      if (cli.confirmed) {
        const status =
          cli.changed || acpLogoutSucceeded || hadAuthenticatedConnection
            ? 'logged_out'
            : 'already_logged_out';
        result = {
          confirmed: true,
          status,
          accountLabel: cli.accountLabel,
          detail:
            status === 'logged_out'
              ? '已退出 Grok 登录，并确认本地代理已经停止。'
              : '当前没有有效的 Grok 登录，本地代理已经停止。',
        };
      } else if (acpLogoutSucceeded) {
        result = {
          confirmed: true,
          status: 'logged_out',
          accountLabel: null,
          detail: `ACP 已确认退出登录并停止本地代理；CLI 复核未完成：${cli.detail}`,
        };
      } else {
        const causes = [acpLogoutError, cli.detail].filter(Boolean).join('；');
        result = {
          confirmed: false,
          status: 'failed',
          accountLabel: null,
          detail: `未能确认 Grok 已退出：${causes || '注销方式不可用。'}`,
        };
      }
    }

    if (!this.shuttingDown) {
      this.connectionEvent(
        result.confirmed
          ? {
              status: 'offline',
              detail: result.detail,
              authenticated: false,
              authMethod: null,
              logoutSupported: false,
              retryable: true,
            }
          : {
              status: 'error',
              detail: result.detail,
              authenticated: null,
              authMethod: null,
              logoutSupported: false,
              issueCode: 'authentication_failed',
              retryable: true,
            },
      );
    }
    return result;
  }

  async disconnect(): Promise<void> {
    this.connectionIntentGeneration += 1;
    await this.disconnectCurrent();
  }

  private async disconnectCurrent(): Promise<void> {
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }
    this.connectionGeneration += 1;
    const operation = (async () => {
      const connection = this.connection;
      const activeSessions = [...this.sessions.keys()];
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
    if (this.logoutPromise) await this.logoutPromise;
    try {
      await this.disconnect();
    } catch {
      await delay(250);
      await this.disconnect();
    }
  }
}
