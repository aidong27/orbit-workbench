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
    expect(pathLookupCommand('win32')).toEqual({ file: 'where.exe', args: ['grok.exe'] });
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

  it('ignores relative environment overrides', () => {
    expect(grokBinaryCandidates('win32', 'C:\\Users\\Alice', '.\\grok.exe')).toEqual([
      'C:\\Users\\Alice\\.grok\\bin\\grok.exe',
    ]);
    expect(grokBinaryCandidates('darwin', '/Users/alice', './grok')).toEqual([
      '/Users/alice/.grok/bin/grok',
    ]);
  });

  it('parses the first result from where.exe output', () => {
    expect(firstLookupResult('C:\\Tools\\grok.exe\r\nC:\\Other\\grok.exe\r\n')).toBe(
      'C:\\Tools\\grok.exe',
    );
    expect(firstLookupResult('  ')).toBeNull();
  });

  it('rejects command wrappers on Windows and accepts native executables', () => {
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
