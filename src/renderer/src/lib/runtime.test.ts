import { describe, expect, it } from 'vitest';
import { shouldUseBrowserPreview } from './runtime';

describe('shouldUseBrowserPreview', () => {
  it('allows the mock only in a development web browser', () => {
    expect(shouldUseBrowserPreview(false, true, 'Mozilla/5.0 Chrome/140')).toBe(true);
  });

  it('never masks a missing preload bridge in Electron', () => {
    expect(shouldUseBrowserPreview(false, true, 'Mozilla/5.0 Electron/43.1.1')).toBe(false);
    expect(shouldUseBrowserPreview(false, false, 'Mozilla/5.0 Electron/43.1.1')).toBe(false);
  });

  it('uses the real bridge whenever it is present', () => {
    expect(shouldUseBrowserPreview(true, true, 'Mozilla/5.0 Chrome/140')).toBe(false);
  });
});
