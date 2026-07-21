import { describe, expect, it } from 'vitest';
import { permissionOutcome } from './grok-acp';

describe('Grok ACP 权限响应', () => {
  const options = new Map([
    ['allow-once', 'allow-once'],
    ['reject-once', 'reject-once'],
  ]);

  it('accepts an option from the original request', () => {
    expect(permissionOutcome(options, { requestId: 'request-1', optionId: 'allow-once' })).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('cancels unknown, omitted, and explicitly cancelled options', () => {
    expect(permissionOutcome(options, { requestId: 'request-1', optionId: 'invented' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(permissionOutcome(options, { requestId: 'request-1' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(
      permissionOutcome(options, {
        requestId: 'request-1',
        optionId: 'allow-once',
        cancelled: true,
      }),
    ).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});
