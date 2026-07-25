import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  terminateWindowsProcessTree,
  windowsJobRunnerCommand,
  windowsTaskkillPath,
} from './windows-process';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  pid: number | undefined = 4242;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    this.emit('exit', null, 'SIGTERM');
    return true;
  });
}

describe('Windows process tree termination', () => {
  it('resolves taskkill from SystemRoot without depending on PATH, ComSpec, or PowerShell', () => {
    expect(
      windowsTaskkillPath({
        Path: 'C:\\untrusted',
        ComSpec: 'D:\\custom\\cmd.exe',
        SystemRoot: '"D:\\Windows 目录"',
      }),
    ).toBe('D:\\Windows 目录\\System32\\taskkill.exe');
    expect(windowsTaskkillPath({ SystemRoot: 'relative' })).toBe(
      'C:\\Windows\\System32\\taskkill.exe',
    );
    expect(windowsTaskkillPath({ SystemRoot: '\\untrusted-root-relative' })).toBe(
      'C:\\Windows\\System32\\taskkill.exe',
    );
    expect(windowsTaskkillPath({ SystemRoot: '\\\\.\\untrusted-device' })).toBe(
      'C:\\Windows\\System32\\taskkill.exe',
    );
  });

  it('resolves SystemRoot case-insensitively and has a fixed missing-value fallback', () => {
    expect(windowsTaskkillPath({ systemroot: 'E:\\WINDOWS' })).toBe(
      'E:\\WINDOWS\\System32\\taskkill.exe',
    );
    expect(windowsTaskkillPath({})).toBe('C:\\Windows\\System32\\taskkill.exe');
  });

  it('treats an exited native job wrapper as converged because closing it closes the Job Object', async () => {
    const child = new FakeChild();
    child.exitCode = 0;
    const runTaskkill = vi.fn();

    await expect(
      terminateWindowsProcessTree(child, { runTaskkill, settleTimeoutMs: 5 }),
    ).resolves.toBe(true);
    expect(runTaskkill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('wraps only fully qualified Windows executables with the Electron parent identity', () => {
    expect(
      windowsJobRunnerCommand('C:\\Program Files\\Orbit\\windows-job-runner.exe', 4242, {
        file: 'D:\\AI Tools\\grok.exe',
        args: ['--no-auto-update', 'agent', 'stdio'],
      }),
    ).toEqual({
      file: 'C:\\Program Files\\Orbit\\windows-job-runner.exe',
      args: [
        '--parent-pid',
        '4242',
        '--',
        'D:\\AI Tools\\grok.exe',
        '--no-auto-update',
        'agent',
        'stdio',
      ],
    });
    expect(() =>
      windowsJobRunnerCommand('.\\windows-job-runner.exe', 4242, {
        file: 'D:\\AI Tools\\grok.exe',
        args: [],
      }),
    ).toThrow('路径无效');
    expect(() =>
      windowsJobRunnerCommand('C:\\Orbit\\windows-job-runner.exe', 0, {
        file: 'D:\\AI Tools\\grok.exe',
        args: [],
      }),
    ).toThrow('父进程 ID');
    expect(() =>
      windowsJobRunnerCommand('C:\\Orbit\\windows-job-runner.exe', 4242, {
        file: 'grok.exe',
        args: [],
      }),
    ).toThrow('完整绝对路径');
  });

  it('uses hidden taskkill with an explicit process tree and force arguments', async () => {
    const child = new FakeChild();
    const runTaskkill = vi.fn(async () => {
      child.exitCode = 1;
      child.emit('exit', 1, null);
    });

    await expect(
      terminateWindowsProcessTree(child, {
        environment: { SystemRoot: 'C:\\Windows' },
        runTaskkill,
        settleTimeoutMs: 20,
        taskkillTimeoutMs: 1234,
      }),
    ).resolves.toBe(true);
    expect(runTaskkill).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '4242', '/t', '/f'],
      { timeout: 1234, windowsHide: true },
    );
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('treats taskkill failure after a natural-exit race as successful', async () => {
    const child = new FakeChild();
    const runTaskkill = vi.fn(async () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      throw new Error('process not found');
    });

    await expect(
      terminateWindowsProcessTree(child, { runTaskkill, settleTimeoutMs: 20 }),
    ).resolves.toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to the direct child without leaking taskkill errors', async () => {
    const child = new FakeChild();
    const runTaskkill = vi.fn(async () => {
      throw new Error('localized taskkill output with private path');
    });

    await expect(
      terminateWindowsProcessTree(child, { runTaskkill, settleTimeoutMs: 5 }),
    ).resolves.toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('falls back safely when a child has no pid', async () => {
    const child = new FakeChild();
    child.pid = undefined;
    const runTaskkill = vi.fn();

    await expect(
      terminateWindowsProcessTree(child, { runTaskkill, settleTimeoutMs: 5 }),
    ).resolves.toBe(true);
    expect(runTaskkill).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('settles with false instead of hanging when neither termination path converges', async () => {
    const child = new FakeChild();
    child.kill.mockImplementation(() => true);
    const runTaskkill = vi.fn(async () => undefined);

    await expect(
      terminateWindowsProcessTree(child, { runTaskkill, settleTimeoutMs: 5 }),
    ).resolves.toBe(false);
    expect(runTaskkill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
