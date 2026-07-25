// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves a long Windows path when the Clipboard API succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const path = String.raw`\\?\C:\Users\测试用户\Documents\非常长的工作区\src\features\windows\index.ts`;

    await expect(copyText(path)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(path);
  });

  it('falls back to a hidden selection when Clipboard API access is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    await expect(copyText(String.raw`C:\workspace\src\main.ts`)).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
    trigger.remove();
  });
});
