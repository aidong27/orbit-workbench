import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from './url';

describe('外部链接校验', () => {
  it('allows absolute HTTPS links', () => {
    expect(isAllowedExternalUrl('https://docs.x.ai/build/overview')).toBe(true);
  });

  it('rejects non-HTTPS, relative, and malformed links', () => {
    expect(isAllowedExternalUrl('http://example.com')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('/local/path')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });
});
