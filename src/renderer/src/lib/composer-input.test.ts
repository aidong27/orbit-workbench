import { describe, expect, it } from 'vitest';
import { shouldSubmitComposerKey } from './composer-input';

describe('shouldSubmitComposerKey', () => {
  it('does not submit while a Chinese IME composition is active', () => {
    expect(
      shouldSubmitComposerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it('does not submit for the legacy Safari and browser IME key code', () => {
    expect(
      shouldSubmitComposerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it('does not submit Shift+Enter', () => {
    expect(
      shouldSubmitComposerKey({
        key: 'Enter',
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it('submits a plain Enter key', () => {
    expect(
      shouldSubmitComposerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it('does not submit other keys', () => {
    expect(
      shouldSubmitComposerKey({
        key: 'Space',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false);
  });
});
