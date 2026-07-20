import { extname, posix, win32 } from 'node:path';

export interface CommandSpec {
  file: string;
  args: string[];
}

export function grokBinaryCandidates(
  platform: NodeJS.Platform,
  homeDirectory: string,
  explicitPath?: string,
): string[] {
  const pathApi = platform === 'win32' ? win32 : posix;
  const defaultName = platform === 'win32' ? 'grok.exe' : 'grok';
  const explicit = explicitPath?.trim();
  return [
    explicit && pathApi.isAbsolute(explicit) ? explicit : undefined,
    pathApi.join(homeDirectory, '.grok', 'bin', defaultName),
  ].filter(
    (candidate, index, all): candidate is string =>
      Boolean(candidate) && all.indexOf(candidate) === index,
  );
}

export function pathLookupCommand(platform: NodeJS.Platform): CommandSpec {
  return platform === 'win32'
    ? { file: 'where.exe', args: ['grok.exe'] }
    : { file: '/usr/bin/env', args: ['which', 'grok'] };
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
  if (platform === 'win32' && extname(binaryPath).toLowerCase() !== '.exe') {
    throw new Error('Windows 版本需要官方安装器提供的 grok.exe；请设置 GROK_BINARY 指向该文件。');
  }
  return { file: binaryPath, args };
}
