import { describe, expect, it } from 'vitest';
import {
  firstLookupResult,
  grokBinaryCandidates,
  grokCommand,
  pathLookupCommand,
} from './grok-platform';

describe('Grok 平台适配', () => {
  it('uses the official Windows grok.exe install path', () => {
    expect(grokBinaryCandidates('win32', 'C:\\Users\\Alice')).toEqual([
      'C:\\Users\\Alice\\.grok\\bin\\grok.exe',
    ]);
    expect(pathLookupCommand('win32')).toBeNull();
  });

  it('keeps the Unix CLI path and lookup command', () => {
    expect(grokBinaryCandidates('darwin', '/Users/alice')).toEqual(['/Users/alice/.grok/bin/grok']);
    expect(pathLookupCommand('linux')).toEqual({
      file: '/usr/bin/env',
      args: ['which', 'grok'],
    });
  });

  it('prefers an explicit binary without duplicating the default', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', 'C:\\Tools\\Grok Build\\grok.exe'),
    ).toEqual(['C:\\Tools\\Grok Build\\grok.exe', 'C:\\Users\\Alice\\.grok\\bin\\grok.exe']);
  });

  it('normalizes a quoted Windows override containing spaces and Unicode', () => {
    expect(
      grokBinaryCandidates(
        'win32',
        'C:\\Users\\爱丽丝',
        '  "C:\\开发工具\\Grok Build\\grok.exe"  ',
      ),
    ).toEqual(['C:\\开发工具\\Grok Build\\grok.exe', 'C:\\Users\\爱丽丝\\.grok\\bin\\grok.exe']);
  });

  it('honors the official absolute GROK_BIN_DIR after GROK_BINARY and before defaults', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', 'C:\\Explicit\\grok.exe', {
        grok_bin_dir: '"D:\\AI 工具\\Grok Bin"',
      }),
    ).toEqual([
      'C:\\Explicit\\grok.exe',
      'D:\\AI 工具\\Grok Bin\\grok.exe',
      'C:\\Users\\Alice\\.grok\\bin\\grok.exe',
    ]);
  });

  it('ignores empty and relative GROK_BIN_DIR values', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', undefined, {
        GROK_BIN_DIR: '  ',
      }),
    ).toEqual(['C:\\Users\\Alice\\.grok\\bin\\grok.exe']);
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', undefined, {
        GROK_BIN_DIR: '.\\portable',
      }),
    ).toEqual(['C:\\Users\\Alice\\.grok\\bin\\grok.exe']);
  });

  it('ignores relative environment overrides', () => {
    expect(grokBinaryCandidates('win32', 'C:\\Users\\Alice', '.\\grok.exe')).toEqual([
      'C:\\Users\\Alice\\.grok\\bin\\grok.exe',
    ]);
    expect(grokBinaryCandidates('darwin', '/Users/alice', './grok')).toEqual([
      '/Users/alice/.grok/bin/grok',
    ]);
  });

  it('does not let unsupported Windows wrappers mask a native installation', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', 'C:\\npm\\grok.cmd', {
        PATH: '"C:\\npm";C:\\Tools\\Grok Build;C:\\工具',
        PATHEXT: '.CMD;.BAT;.EXE',
      }),
    ).toEqual([
      'C:\\Users\\Alice\\.grok\\bin\\grok.exe',
      'C:\\npm\\grok.exe',
      'C:\\Tools\\Grok Build\\grok.exe',
      'C:\\工具\\grok.exe',
    ]);
  });

  it('rejects drive-root-relative and device paths that path.win32 reports as absolute', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', '\\untrusted\\grok.exe', {
        PATH: '\\untrusted;/rooted;C:\\Trusted',
      }),
    ).toEqual(['C:\\Users\\Alice\\.grok\\bin\\grok.exe', 'C:\\Trusted\\grok.exe']);
    expect(() => grokCommand('\\untrusted\\grok.exe', [], 'win32')).toThrow('完整绝对');
    expect(() => grokCommand('\\\\.\\pipe\\grok.exe', [], 'win32')).toThrow('完整绝对');
  });

  it('accepts fully-qualified drive, UNC, and extended-length executable paths', () => {
    for (const binary of [
      'C:\\Tools\\grok.exe',
      '\\\\server\\share\\grok.exe',
      '\\\\?\\C:\\Tools\\grok.exe',
      '\\\\?\\UNC\\server\\share\\grok.exe',
    ]) {
      expect(grokCommand(binary, ['--version'], 'win32')).toEqual({
        file: binary,
        args: ['--version'],
      });
    }
  });

  it('de-duplicates Windows PATH candidates case-insensitively', () => {
    expect(
      grokBinaryCandidates('win32', 'C:\\Users\\Alice', undefined, {
        Path: 'D:\\AI Home\\.grok\\bin;d:\\ai home\\.GROK\\BIN',
      }),
    ).toEqual(['C:\\Users\\Alice\\.grok\\bin\\grok.exe', 'D:\\AI Home\\.grok\\bin\\grok.exe']);
  });

  it('parses the first Unix lookup result', () => {
    expect(firstLookupResult('C:\\Tools\\grok.exe\r\nC:\\Other\\grok.exe\r\n')).toBe(
      'C:\\Tools\\grok.exe',
    );
    expect(firstLookupResult('  ')).toBeNull();
  });

  it('rejects command wrappers and relative paths on Windows while preserving native arguments', () => {
    expect(grokCommand('C:\\Tools\\grok.exe', ['agent', 'stdio'], 'win32')).toEqual({
      file: 'C:\\Tools\\grok.exe',
      args: ['agent', 'stdio'],
    });
    expect(() => grokCommand('C:\\Tools\\grok.cmd', ['agent', 'stdio'], 'win32')).toThrow(
      'grok.exe',
    );
    expect(() => grokCommand('.\\grok.exe', ['agent', 'stdio'], 'win32')).toThrow('绝对路径');
  });
});
