import { extname, posix, win32 } from 'node:path';

export interface CommandSpec {
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

function unquotePath(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  const normalized = value.replaceAll('/', '\\');
  if (/^[a-z]:\\/iu.test(normalized)) return true;
  if (/^\\\\\?\\(?:[a-z]:\\|unc\\[^\\]+\\[^\\]+(?:\\|$))/iu.test(normalized)) return true;
  return /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/u.test(normalized);
}

function isSafeAbsoluteWindowsExecutable(value: string): boolean {
  return (
    isFullyQualifiedWindowsPath(value) &&
    extname(value).toLowerCase() === '.exe' &&
    !value.includes('"') &&
    !containsControlCharacters(value)
  );
}

function windowsPathCandidates(environment: Readonly<Record<string, unknown>>): string[] {
  const pathValue = environmentValue(environment, 'PATH');
  if (!pathValue) return [];
  return pathValue
    .split(win32.delimiter)
    .map(unquotePath)
    .filter(isFullyQualifiedWindowsPath)
    .map((directory) => win32.join(directory, 'grok.exe'));
}

export function grokBinaryCandidates(
  platform: NodeJS.Platform,
  homeDirectory: string,
  explicitPath?: string,
  environment: Readonly<Record<string, unknown>> = {},
): string[] {
  const pathApi = platform === 'win32' ? win32 : posix;
  const defaultName = platform === 'win32' ? 'grok.exe' : 'grok';
  const explicit = explicitPath ? unquotePath(explicitPath) : undefined;
  const rawGrokBinDirectory =
    platform === 'win32' ? environmentValue(environment, 'GROK_BIN_DIR') : undefined;
  const grokBinDirectory =
    typeof rawGrokBinDirectory === 'string' ? unquotePath(rawGrokBinDirectory) : undefined;
  const candidates = [
    explicit && pathApi.isAbsolute(explicit) ? explicit : undefined,
    grokBinDirectory && pathApi.isAbsolute(grokBinDirectory)
      ? pathApi.join(grokBinDirectory, defaultName)
      : undefined,
    pathApi.join(homeDirectory, '.grok', 'bin', defaultName),
    ...(platform === 'win32' ? windowsPathCandidates(environment) : []),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    if (!candidate) return false;
    if (platform === 'win32' && !isSafeAbsoluteWindowsExecutable(candidate)) return false;
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pathLookupCommand(platform: NodeJS.Platform): CommandSpec | null {
  return platform === 'win32' ? null : { file: '/usr/bin/env', args: ['which', 'grok'] };
}

export function firstLookupResult(stdout: string): string | null {
  const first = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^"|"$/gu, ''))
    .find(Boolean);
  return first ?? null;
}

export function grokCommand(
  binaryPath: string,
  args: string[],
  platform: NodeJS.Platform,
): CommandSpec {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(binaryPath)) {
    throw new Error('Grok Build CLI 路径必须是绝对路径。');
  }
  if (platform === 'win32' && !isSafeAbsoluteWindowsExecutable(binaryPath)) {
    throw new Error(
      'Windows 版本需要官方安装器提供的完整绝对 grok.exe 路径；请设置 GROK_BINARY 指向该文件。',
    );
  }
  return { file: binaryPath, args };
}
