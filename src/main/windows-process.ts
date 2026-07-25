import type { ExecFileOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface KillableChild {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  pid?: number;
  removeListener(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  signalCode: NodeJS.Signals | null;
}

type TaskkillRunner = (
  file: string,
  args: readonly string[],
  options: Pick<ExecFileOptions, 'timeout' | 'windowsHide'>,
) => Promise<unknown>;

export interface WindowsTerminationOptions {
  environment?: Readonly<Record<string, unknown>>;
  runTaskkill?: TaskkillRunner;
  settleTimeoutMs?: number;
  taskkillTimeoutMs?: number;
}

export interface NativeCommand {
  file: string;
  args: string[];
}

function environmentValue(
  environment: Readonly<Record<string, unknown>>,
  requestedName: string,
): string | undefined {
  const requested = requestedName.toUpperCase();
  for (const [name, value] of Object.entries(environment)) {
    if (name.toUpperCase() === requested && typeof value === 'string') return value;
  }
  return undefined;
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isFullyQualifiedWindowsSystemRoot(value: string): boolean {
  const normalized = value.replaceAll('/', '\\');
  return /^[a-z]:\\/iu.test(normalized) || /^\\\\\?\\[a-z]:\\/iu.test(normalized);
}

function safeWindowsRoot(environment: Readonly<Record<string, unknown>>): string {
  const candidate =
    environmentValue(environment, 'SYSTEMROOT') ?? environmentValue(environment, 'WINDIR');
  const trimmed = candidate?.trim().replace(/^"(.*)"$/u, '$1');
  return trimmed &&
    isFullyQualifiedWindowsSystemRoot(trimmed) &&
    !trimmed.includes('"') &&
    !containsControlCharacters(trimmed)
    ? trimmed
    : 'C:\\Windows';
}

export function windowsTaskkillPath(
  environment: Readonly<Record<string, unknown>> = process.env,
): string {
  return win32.join(safeWindowsRoot(environment), 'System32', 'taskkill.exe');
}

function isFullyQualifiedWindowsExecutable(value: string): boolean {
  const normalized = value.replaceAll('/', '\\');
  const absolute =
    /^[a-z]:\\/iu.test(normalized) ||
    /^\\\\\?\\(?:[a-z]:\\|unc\\[^\\]+\\[^\\]+(?:\\|$))/iu.test(normalized) ||
    /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/u.test(normalized);
  return (
    absolute &&
    win32.extname(normalized).toLowerCase() === '.exe' &&
    !normalized.includes('"') &&
    !containsControlCharacters(normalized)
  );
}

export function windowsJobRunnerCommand(
  runnerPath: string,
  parentPid: number,
  command: NativeCommand,
): NativeCommand {
  if (!isFullyQualifiedWindowsExecutable(runnerPath)) {
    throw new Error('Windows 进程隔离组件路径无效。');
  }
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || parentPid > 0xffff_ffff) {
    throw new Error('Windows 进程隔离组件收到无效的父进程 ID。');
  }
  if (!isFullyQualifiedWindowsExecutable(command.file)) {
    throw new Error('Windows 进程隔离组件只能启动完整绝对路径的 .exe。');
  }
  return {
    file: runnerPath,
    args: ['--parent-pid', String(parentPid), '--', command.file, ...command.args],
  };
}

function hasExited(child: KillableChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: KillableChild, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(result);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
    if (hasExited(child)) finish(true);
  });
}

const defaultTaskkillRunner: TaskkillRunner = async (file, args, options) => {
  await execFileAsync(file, [...args], options);
};

export async function terminateWindowsProcessTree(
  child: KillableChild,
  options: WindowsTerminationOptions = {},
): Promise<boolean> {
  // On Windows this handle belongs to windows-job-runner.exe, not directly to
  // Grok. The runner owns a kill-on-close Job Object, so its exit is the OS
  // guarantee that remaining Grok descendants have already been terminated.
  if (hasExited(child)) return true;
  const settleTimeoutMs = options.settleTimeoutMs ?? 750;
  const runTaskkill = options.runTaskkill ?? defaultTaskkillRunner;

  if (child.pid) {
    try {
      await runTaskkill(
        windowsTaskkillPath(options.environment),
        ['/pid', String(child.pid), '/t', '/f'],
        {
          timeout: options.taskkillTimeoutMs ?? 5_000,
          windowsHide: true,
        },
      );
    } catch {
      // taskkill returns a failure when the process wins the exit race. Recheck
      // the child before falling back to killing only the direct process.
    }
    if (await waitForExit(child, settleTimeoutMs)) return true;
  }

  try {
    child.kill();
  } catch {
    // The child may have exited between the state check and kill().
  }
  return waitForExit(child, settleTimeoutMs);
}
