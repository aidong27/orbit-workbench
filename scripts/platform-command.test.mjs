import { describe, expect, it } from 'vitest';

import { pnpmInvocation } from './platform-command.mjs';

describe('pnpmInvocation', () => {
  it('runs the pnpm JavaScript entrypoint through Node on every platform', () => {
    expect(
      pnpmInvocation({
        npmExecPath: 'C:\\pnpm\\pnpm.cjs',
        nodeExecPath: 'C:\\node\\node.exe',
      }),
    ).toEqual({
      executable: 'C:\\node\\node.exe',
      arguments: ['C:\\pnpm\\pnpm.cjs'],
    });
  });

  it('fails clearly when the script is not launched by pnpm', () => {
    expect(() => pnpmInvocation({ npmExecPath: '', nodeExecPath: '/usr/bin/node' })).toThrow(
      'Run this license script through pnpm',
    );
  });
});
