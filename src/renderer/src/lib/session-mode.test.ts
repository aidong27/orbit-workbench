import { describe, expect, it } from 'vitest';
import { decideInitialMode } from './session-mode';

describe('decideInitialMode', () => {
  it('accepts the agent current mode when the user made no explicit choice', () => {
    expect(decideInitialMode(null, 'default', [{ id: 'default', name: 'Default' }])).toEqual({
      desiredModeId: 'default',
      shouldSwitch: false,
      unsupported: false,
    });
  });

  it('rejects only an explicit unsupported preference', () => {
    expect(
      decideInitialMode('normal', 'default', [{ id: 'default', name: 'Default' }]),
    ).toMatchObject({ desiredModeId: 'normal', unsupported: true });
  });
});
