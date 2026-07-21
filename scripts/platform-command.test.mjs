import { describe, expect, it } from 'vitest';

import { pnpmExecutable } from './platform-command.mjs';

describe('pnpmExecutable', () => {
  it('uses the Windows command shim on win32', () => {
    expect(pnpmExecutable('win32')).toBe('pnpm.cmd');
  });

  it('uses the executable name on Unix platforms', () => {
    expect(pnpmExecutable('darwin')).toBe('pnpm');
    expect(pnpmExecutable('linux')).toBe('pnpm');
  });
});
