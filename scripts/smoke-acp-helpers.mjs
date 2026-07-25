import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, posix, win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALWAYS_BLOCKED_NAMES = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
]);

const DEFAULT_ALLOWED_NAMES = new Set([
  'OS',
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'XAI_API_KEY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

const PROXY_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']);

const WINDOWS_RUNTIME_NAMES = new Set([
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_ARCHITEW6432',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);

function environmentValue(environment, requestedName) {
  const requested = requestedName.toUpperCase();
  for (const [name, value] of Object.entries(environment)) {
    if (name.toUpperCase() === requested && typeof value === 'string') return value;
  }
  return undefined;
}

function unquotePath(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function containsControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isFullyQualifiedWindowsPath(value) {
  const normalized = value.replaceAll('/', '\\');
  if (/^[a-z]:\\/iu.test(normalized)) return true;
  if (/^\\\\\?\\(?:[a-z]:\\|unc\\[^\\]+\\[^\\]+(?:\\|$))/iu.test(normalized)) return true;
  return /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/u.test(normalized);
}

function isSafeAbsoluteWindowsExecutable(value) {
  return (
    isFullyQualifiedWindowsPath(value) &&
    extname(value).toLowerCase() === '.exe' &&
    !value.includes('"') &&
    !containsControlCharacters(value)
  );
}

function windowsPathCandidates(environment) {
  const pathValue = environmentValue(environment, 'PATH');
  if (!pathValue) return [];
  return pathValue
    .split(win32.delimiter)
    .map(unquotePath)
    .filter(isFullyQualifiedWindowsPath)
    .map((directory) => win32.join(directory, 'grok.exe'));
}

export function grokBinaryCandidates(platform, homeDirectory, environment = {}) {
  const pathApi = platform === 'win32' ? win32 : posix;
  const defaultName = platform === 'win32' ? 'grok.exe' : 'grok';
  const explicitValue = environmentValue(environment, 'GROK_BINARY');
  const explicit = explicitValue ? unquotePath(explicitValue) : undefined;
  const grokBinValue =
    platform === 'win32' ? environmentValue(environment, 'GROK_BIN_DIR') : undefined;
  const grokBinDirectory = grokBinValue ? unquotePath(grokBinValue) : undefined;
  const candidates = [
    explicit && pathApi.isAbsolute(explicit) ? explicit : undefined,
    grokBinDirectory && pathApi.isAbsolute(grokBinDirectory)
      ? pathApi.join(grokBinDirectory, defaultName)
      : undefined,
    pathApi.join(homeDirectory, '.grok', 'bin', defaultName),
    ...(platform === 'win32' ? windowsPathCandidates(environment) : []),
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    if (platform === 'win32' && !isSafeAbsoluteWindowsExecutable(candidate)) return false;
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstLookupResult(stdout) {
  return (
    stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ''))
      .find(Boolean) ?? null
  );
}

async function defaultUnixLookup() {
  const { stdout } = await execFileAsync('/usr/bin/env', ['which', 'grok'], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
  });
  return firstLookupResult(stdout);
}

export async function resolveGrokBinary({
  platform = process.platform,
  homeDirectory = homedir(),
  environment = process.env,
  accessFile = access,
  statFile = stat,
  lookupUnix = defaultUnixLookup,
} = {}) {
  for (const candidate of grokBinaryCandidates(platform, homeDirectory, environment)) {
    try {
      if (!(await statFile(candidate)).isFile()) continue;
      await accessFile(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Continue through the ordered candidates.
    }
  }
  if (platform === 'win32') return null;

  try {
    const candidate = await lookupUnix();
    if (!candidate || !posix.isAbsolute(candidate)) return null;
    if (!(await statFile(candidate)).isFile()) return null;
    await accessFile(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function isDefaultAllowed(name, platform) {
  const normalizedName = name.toUpperCase();
  const platformName = platform === 'win32' ? normalizedName : name;
  if (
    DEFAULT_ALLOWED_NAMES.has(platformName) ||
    platformName.startsWith('LC_') ||
    platformName.startsWith('GROK_')
  ) {
    return true;
  }
  return PROXY_NAMES.has(normalizedName) || WINDOWS_RUNTIME_NAMES.has(normalizedName);
}

export function buildSmokeChildEnvironment(
  source,
  platform = process.platform,
  extraAllowedNames = [],
) {
  const extraAllowed = new Set(
    extraAllowedNames.map((name) => (platform === 'win32' ? name.toUpperCase() : name)),
  );
  const environment = {};

  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    const normalizedName = platform === 'win32' ? name.toUpperCase() : name;
    if (ALWAYS_BLOCKED_NAMES.has(name.toUpperCase())) continue;
    if (!isDefaultAllowed(name, platform) && !extraAllowed.has(normalizedName)) continue;
    if (Object.hasOwn(environment, normalizedName)) continue;
    environment[normalizedName] = value;
  }

  return environment;
}

function safeWindowsRoot(environment) {
  const candidate =
    environmentValue(environment, 'SYSTEMROOT') ?? environmentValue(environment, 'WINDIR');
  const trimmed = candidate?.trim().replace(/^"(.*)"$/u, '$1');
  return trimmed &&
    (/^[a-z]:[\\/]/iu.test(trimmed) || /^\\\\\?\\[a-z]:[\\/]/iu.test(trimmed)) &&
    !trimmed.includes('"') &&
    !containsControlCharacters(trimmed)
    ? trimmed
    : 'C:\\Windows';
}

export function windowsTaskkillPath(environment = process.env) {
  return win32.join(safeWindowsRoot(environment), 'System32', 'taskkill.exe');
}

function isFullyQualifiedWindowsExecutable(value) {
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

export function windowsJobRunnerCommand(runnerPath, parentPid, command) {
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

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(result);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
    if (hasExited(child)) finish(true);
  });
}

const defaultTaskkillRunner = async (file, args, options) => {
  await execFileAsync(file, args, options);
};

export async function forceTerminateProcessTree(
  child,
  {
    platform = process.platform,
    environment = process.env,
    processKill = process.kill.bind(process),
    runTaskkill = defaultTaskkillRunner,
    settleTimeoutMs = 750,
  } = {},
) {
  if (platform === 'win32') {
    if (hasExited(child)) return true;
    if (child.pid) {
      try {
        await runTaskkill(
          windowsTaskkillPath(environment),
          ['/pid', String(child.pid), '/t', '/f'],
          { timeout: 5_000, windowsHide: true },
        );
      } catch {
        // Recheck the process before falling back to the direct child.
      }
      if (await waitForExit(child, settleTimeoutMs)) return true;
    }
    try {
      child.kill();
    } catch {
      // The direct child may have won the exit race.
    }
    return waitForExit(child, settleTimeoutMs);
  }

  if (!child.pid) return hasExited(child);
  const leaderAlreadyExited = hasExited(child);
  try {
    processKill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process may have won the exit race.
    }
  }
  if (leaderAlreadyExited) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    await waitForExit(child, 500);
  }
  try {
    processKill(-child.pid, 0);
    processKill(-child.pid, 'SIGKILL');
  } catch {
    // The process group exited during the grace period.
  }
  return waitForExit(child, settleTimeoutMs);
}

export async function gracefullyShutdownChild(
  child,
  {
    platform = process.platform,
    environment = process.env,
    graceTimeoutMs = 1_500,
    forceTerminate = forceTerminateProcessTree,
  } = {},
) {
  if (hasExited(child)) {
    return platform === 'win32' ? true : forceTerminate(child, { platform, environment });
  }

  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
    return forceTerminate(child, { platform, environment });
  }
  if (await waitForExit(child, graceTimeoutMs)) {
    return platform === 'win32' ? true : forceTerminate(child, { platform, environment });
  }
  return forceTerminate(child, { platform, environment });
}
