import { afterEach, describe, expect, it, vi } from 'vitest';
import { permissionOutcome, settlesWithin } from './grok-acp';

describe('Grok ACP lifecycle helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports protocol settlement for both fulfillment and rejection', async () => {
    await expect(settlesWithin(Promise.resolve(), 1_000)).resolves.toBe(true);
    await expect(settlesWithin(Promise.reject(new Error('protocol stopped')), 1_000)).resolves.toBe(
      true,
    );
  });

  it('reports a turn that does not settle before the convergence deadline', async () => {
    vi.useFakeTimers();
    const result = settlesWithin(new Promise<void>(() => undefined), 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe(false);
  });

  it('returns the original protocol option id behind a bounded UI alias', () => {
    const originalOptionId = `allow-${'x'.repeat(2_000)}`;
    expect(
      permissionOutcome(new Map([['ui-option-1', originalOptionId]]), {
        requestId: 'request-1',
        optionId: 'ui-option-1',
      }),
    ).toEqual({ outcome: { outcome: 'selected', optionId: originalOptionId } });
  });
});
