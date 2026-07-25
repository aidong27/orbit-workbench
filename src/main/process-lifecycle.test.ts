import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gracefullyShutdownProcess } from './process-lifecycle';

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdin = {
    destroyed: false,
    end: vi.fn(),
  };
}

describe('graceful process shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not touch a process that already exited', async () => {
    const child = new FakeProcess();
    child.exitCode = 0;
    const forceTerminate = vi.fn();

    await gracefullyShutdownProcess(child, { forceTerminate, graceTimeoutMs: 10 });

    expect(child.stdin.end).not.toHaveBeenCalled();
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('still cleans an exited Unix leader process group so descendants are not orphaned', async () => {
    const child = new FakeProcess();
    child.exitCode = 0;
    const cleanupAfterExit = vi.fn(async () => undefined);
    const forceTerminate = vi.fn();

    await gracefullyShutdownProcess(child, {
      cleanupAfterExit,
      forceTerminate,
      graceTimeoutMs: 10,
    });

    expect(child.stdin.end).not.toHaveBeenCalled();
    expect(cleanupAfterExit).toHaveBeenCalledOnce();
    expect(cleanupAfterExit).toHaveBeenCalledWith(child);
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('ends stdin first and allows a Windows process to exit gracefully', async () => {
    const child = new FakeProcess();
    child.stdin.end.mockImplementation(() => {
      child.exitCode = 0;
      child.emit('exit');
    });
    const forceTerminate = vi.fn();

    await gracefullyShutdownProcess(child, { forceTerminate, graceTimeoutMs: 10 });

    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('cleans a Unix process group after its leader exits during the grace period', async () => {
    const child = new FakeProcess();
    child.stdin.end.mockImplementation(() => {
      child.exitCode = 0;
      child.emit('exit');
    });
    const cleanupAfterExit = vi.fn(async () => undefined);
    const forceTerminate = vi.fn();

    await gracefullyShutdownProcess(child, {
      cleanupAfterExit,
      forceTerminate,
      graceTimeoutMs: 10,
    });

    expect(cleanupAfterExit).toHaveBeenCalledOnce();
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('uses bounded forced termination only after the grace period expires', async () => {
    vi.useFakeTimers();
    const child = new FakeProcess();
    const forceTerminate = vi.fn(async () => undefined);
    const shutdown = gracefullyShutdownProcess(child, {
      forceTerminate,
      graceTimeoutMs: 1_500,
    });

    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(forceTerminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(forceTerminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(forceTerminate).toHaveBeenCalledOnce();
    expect(forceTerminate).toHaveBeenCalledWith(child);
  });

  it('does not run post-exit cleanup twice after forced termination', async () => {
    vi.useFakeTimers();
    const child = new FakeProcess();
    const cleanupAfterExit = vi.fn(async () => undefined);
    const forceTerminate = vi.fn(async () => undefined);
    const shutdown = gracefullyShutdownProcess(child, {
      cleanupAfterExit,
      forceTerminate,
      graceTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    await shutdown;

    expect(forceTerminate).toHaveBeenCalledOnce();
    expect(cleanupAfterExit).not.toHaveBeenCalled();
  });

  it('forces termination when closing stdin fails', async () => {
    const child = new FakeProcess();
    child.stdin.end.mockImplementation(() => {
      throw new Error('broken pipe');
    });
    const forceTerminate = vi.fn(async () => undefined);

    await gracefullyShutdownProcess(child, { forceTerminate, graceTimeoutMs: 1_500 });

    expect(forceTerminate).toHaveBeenCalledOnce();
  });

  it('does not report shutdown success when forced termination cannot be confirmed', async () => {
    vi.useFakeTimers();
    const child = new FakeProcess();
    const forceTerminate = vi.fn(async () => {
      throw new Error('termination not confirmed');
    });
    const shutdown = gracefullyShutdownProcess(child, {
      forceTerminate,
      graceTimeoutMs: 10,
    });

    const assertion = expect(shutdown).rejects.toThrow('termination not confirmed');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(forceTerminate).toHaveBeenCalledOnce();
  });
});
