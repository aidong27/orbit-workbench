import { describe, expect, it, vi } from 'vitest';
import { runSessionTaskOnce } from './in-flight';

describe('runSessionTaskOnce', () => {
  it('deduplicates concurrent work for the same local session', async () => {
    const active = new Set<string>();
    let release: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );

    const first = runSessionTaskOnce(active, 'session-a', task);
    const duplicate = runSessionTaskOnce(active, 'session-a', task);
    expect(await duplicate).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);

    release?.();
    await expect(first).resolves.toBe('done');
    expect(active.has('session-a')).toBe(false);
  });

  it('releases the session lock after a failure', async () => {
    const active = new Set<string>();
    await expect(
      runSessionTaskOnce(active, 'session-a', async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');

    await expect(runSessionTaskOnce(active, 'session-a', async () => 'retry')).resolves.toBe(
      'retry',
    );
  });
});
