import { describe, expect, it } from 'vitest';
import { sanitizeDiagnostic, sanitizeDiagnosticLine } from './grok-diagnostics';

describe('sanitizeDiagnostic', () => {
  it('redacts named and recognizable credentials and shortens the home path', () => {
    const githubTokenExample = `github_${'pat'}_abcdefghijk`;
    const result = sanitizeDiagnostic(
      `XAI_API_KEY=example-secret-value token: ${githubTokenExample} /Users/alice/private`,
      '/Users/alice',
    );

    expect(result).not.toContain('secretvalue');
    expect(result).not.toContain(githubTokenExample);
    expect(result).not.toContain('/Users/alice');
    expect(result).toContain('~/private');
  });

  it('redacts bearer, basic, and quoted JSON credentials without exposing their values', () => {
    const result = sanitizeDiagnostic(
      'Authorization: Bearer bearer-secret\nAuthorization=Basic dXNlcjpwYXNz\n{"api_key":"json-secret"}',
      '/Users/alice',
    );

    expect(result).not.toContain('bearer-secret');
    expect(result).not.toContain('dXNlcjpwYXNz');
    expect(result).not.toContain('json-secret');
    expect(result.match(/\[已隐藏\]/gu)).toHaveLength(3);
  });

  it('redacts quoted credentials containing spaces and neutralizes bidi controls', () => {
    const result = sanitizeDiagnosticLine(
      'password="two words secret" Authorization: "Bearer another secret" safe\u202Etxt',
      '/Users/alice',
      '已隐藏',
    );

    expect(result).not.toContain('two words secret');
    expect(result).not.toContain('another secret');
    expect(result).not.toContain('\u202E');
    expect(result).toBe('password=[已隐藏] Authorization: [已隐藏] safe txt');
  });

  it('redacts a Windows home path regardless of filesystem casing', () => {
    const result = sanitizeDiagnostic(
      String.raw`spawn C:\USERS\Alice\.grok\bin\grok.exe failed in c:\users\alice\private`,
      String.raw`C:\Users\Alice`,
    );

    expect(result).not.toMatch(/c:\\users\\alice/iu);
    expect(result).toBe(String.raw`spawn ~\.grok\bin\grok.exe failed in ~\private`);
  });

  it('redacts URL credentials and turns untrusted multiline metadata into one bounded line', () => {
    const result = sanitizeDiagnosticLine(
      'grok 1.2.3\nhttps://alice:super-secret@example.test\r\nC:\\Users\\Alice\\private',
      'C:\\Users\\Alice',
      '已安装',
      80,
    );

    expect(result).toBe('grok 1.2.3 https://[凭据已隐藏]@example.test ~\\private');
    expect(result).not.toContain('alice');
    expect(result).not.toContain('super-secret');
    expect(result).not.toMatch(/[\r\n]/u);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});
