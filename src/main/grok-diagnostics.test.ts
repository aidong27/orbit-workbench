import { describe, expect, it } from 'vitest';
import { sanitizeDiagnostic } from './grok-diagnostics';

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
});
