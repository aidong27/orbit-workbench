import { describe, expect, it } from 'vitest';
import { hasPrimaryShortcutModifier, shouldBlockBackgroundShortcut } from './keyboard';

describe('hasPrimaryShortcutModifier', () => {
  it('accepts Windows Ctrl and macOS Command shortcuts', () => {
    expect(hasPrimaryShortcutModifier({ ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
  });

  it('does not hijack AltGr text input reported as Ctrl+Alt', () => {
    expect(hasPrimaryShortcutModifier({ ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
  });

  it('blocks background app commands while a modal owns focus', () => {
    for (const key of ['k', 'K', 'n', 'N', ',']) {
      expect(
        shouldBlockBackgroundShortcut(true, {
          key,
          ctrlKey: true,
          metaKey: false,
          altKey: false,
        }),
      ).toBe(true);
    }
    expect(
      shouldBlockBackgroundShortcut(false, {
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      shouldBlockBackgroundShortcut(true, {
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });
});
