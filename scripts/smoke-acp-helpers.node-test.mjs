import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { buildGrokChildEnvironment } from '../src/main/grok-environment.ts';
import { grokBinaryCandidates as productionGrokBinaryCandidates } from '../src/main/grok-platform.ts';
import {
  windowsJobRunnerCommand as productionWindowsJobRunnerCommand,
  windowsTaskkillPath as productionWindowsTaskkillPath,
} from '../src/main/windows-process.ts';
import {
  buildSmokeChildEnvironment,
  forceTerminateProcessTree,
  gracefullyShutdownChild,
  grokBinaryCandidates,
  resolveGrokBinary,
  windowsJobRunnerCommand,
  windowsTaskkillPath,
} from './smoke-acp-helpers.mjs';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.pid = 4242;
    this.signalCode = null;
    this.stdin = {
      destroyed: false,
      end: () => undefined,
    };
  }

  kill() {
    this.signalCode = 'SIGTERM';
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
}

test('Windows Grok discovery follows the production order with quoted Unicode paths', () => {
  assert.deepEqual(
    grokBinaryCandidates('win32', 'C:\\Users\\爱丽丝', {
      GROK_BINARY: ' "C:\\开发工具\\Grok Build\\grok.exe" ',
      GROK_BIN_DIR: '"D:\\AI 工具\\Grok Bin"',
      Path: '"E:\\Portable Apps";F:\\工具',
    }),
    [
      'C:\\开发工具\\Grok Build\\grok.exe',
      'D:\\AI 工具\\Grok Bin\\grok.exe',
      'C:\\Users\\爱丽丝\\.grok\\bin\\grok.exe',
      'E:\\Portable Apps\\grok.exe',
      'F:\\工具\\grok.exe',
    ],
  );
});

test('script discovery stays in parity with the production TypeScript boundary', () => {
  const environment = {
    GROK_BINARY: ' "C:\\开发工具\\Grok Build\\grok.exe" ',
    GROK_BIN_DIR: '"D:\\AI 工具\\Grok Bin"',
    Path: '"E:\\Portable Apps";F:\\工具;E:\\PORTABLE APPS',
    PATHEXT: '.CMD;.BAT;.EXE',
  };
  assert.deepEqual(
    grokBinaryCandidates('win32', 'C:\\Users\\爱丽丝', environment),
    productionGrokBinaryCandidates(
      'win32',
      'C:\\Users\\爱丽丝',
      environment.GROK_BINARY,
      environment,
    ),
  );
});

test('Windows discovery rejects wrappers, relative overrides, and control characters', () => {
  assert.deepEqual(
    grokBinaryCandidates('win32', 'C:\\Users\\Alice', {
      GROK_BINARY: 'C:\\npm\\grok.cmd',
      GROK_BIN_DIR: '.\\relative',
      PATH: 'C:\\valid;C:\\bad\nsegment;C:\\VALID',
      PATHEXT: '.CMD;.BAT;.EXE',
    }),
    ['C:\\Users\\Alice\\.grok\\bin\\grok.exe', 'C:\\valid\\grok.exe'],
  );
  assert.deepEqual(
    grokBinaryCandidates('win32', 'C:\\Users\\Alice', {
      GROK_BINARY: '\\untrusted\\grok.exe',
      PATH: '\\untrusted;/rooted;C:\\trusted',
    }),
    ['C:\\Users\\Alice\\.grok\\bin\\grok.exe', 'C:\\trusted\\grok.exe'],
  );
});

test('binary resolution checks ordered native candidates without invoking Windows wrappers', async () => {
  const checked = [];
  const selected = 'D:\\Tools\\grok.exe';
  const resolved = await resolveGrokBinary({
    platform: 'win32',
    homeDirectory: 'C:\\Users\\Alice',
    environment: {
      GROK_BINARY: 'C:\\missing\\grok.exe',
      GROK_BIN_DIR: 'D:\\Tools',
      PATH: 'C:\\npm',
    },
    accessFile: async (candidate) => {
      checked.push(candidate);
      if (candidate !== selected) throw new Error('missing');
    },
    statFile: async () => ({ isFile: () => true }),
  });

  assert.equal(resolved, selected);
  assert.deepEqual(checked, ['C:\\missing\\grok.exe', selected]);
});

test('binary resolution rejects directories named grok.exe before access or spawn', async () => {
  let accessCalls = 0;
  const resolved = await resolveGrokBinary({
    platform: 'win32',
    homeDirectory: 'C:\\Users\\Alice',
    environment: {},
    statFile: async () => ({ isFile: () => false }),
    accessFile: async () => {
      accessCalls += 1;
    },
  });

  assert.equal(resolved, null);
  assert.equal(accessCalls, 0);
});

test('smoke child environment mirrors the production allowlist and blocks unrelated secrets', () => {
  const source = {
    Path: 'C:\\Windows\\System32',
    PATH: 'C:\\shadow',
    grok_home: 'C:\\Users\\Alice\\.grok',
    xai_api_key: 'xai-key',
    node_options: '--require C:\\inject.cjs',
    ELECTRON_RUN_AS_NODE: '1',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    GH_TOKEN: 'github-secret',
    NPM_TOKEN: 'npm-secret',
  };
  const environment = buildSmokeChildEnvironment(source, 'win32');
  assert.deepEqual(environment, {
    PATH: 'C:\\Windows\\System32',
    GROK_HOME: 'C:\\Users\\Alice\\.grok',
    XAI_API_KEY: 'xai-key',
  });
  assert.deepEqual(environment, buildGrokChildEnvironment(source, [], 'win32'));
});

test('taskkill is resolved from absolute System32 and never from PATH or ComSpec', () => {
  const environment = {
    Path: 'C:\\untrusted',
    ComSpec: 'C:\\custom\\cmd.exe',
    systemroot: '"D:\\Windows 目录"',
  };
  assert.equal(windowsTaskkillPath(environment), 'D:\\Windows 目录\\System32\\taskkill.exe');
  assert.equal(windowsTaskkillPath(environment), productionWindowsTaskkillPath(environment));
  assert.equal(windowsTaskkillPath({}), 'C:\\Windows\\System32\\taskkill.exe');
  assert.equal(
    windowsTaskkillPath({ SystemRoot: '\\untrusted-root-relative' }),
    'C:\\Windows\\System32\\taskkill.exe',
  );
  assert.equal(
    windowsTaskkillPath({ SystemRoot: '\\\\.\\untrusted-device' }),
    'C:\\Windows\\System32\\taskkill.exe',
  );
});

test('Windows Job Object launch command stays in parity with production', () => {
  const runnerPath = 'C:\\Program Files\\Orbit\\windows-job-runner.exe';
  const command = {
    file: 'D:\\AI Tools\\grok.exe',
    args: ['--no-auto-update', 'agent', 'stdio'],
  };
  assert.deepEqual(
    windowsJobRunnerCommand(runnerPath, 4242, command),
    productionWindowsJobRunnerCommand(runnerPath, 4242, command),
  );
});

test('graceful shutdown ends stdin and does not force a naturally exiting child', async () => {
  const child = new FakeChild();
  const sequence = [];
  child.stdin.end = () => {
    sequence.push('stdin.end');
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };

  const result = await gracefullyShutdownChild(child, {
    platform: 'win32',
    graceTimeoutMs: 10,
    forceTerminate: async () => {
      sequence.push('force');
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(sequence, ['stdin.end']);
});

test('graceful shutdown waits before bounded forced termination', async () => {
  const child = new FakeChild();
  const sequence = [];
  child.stdin.end = () => sequence.push('stdin.end');

  const result = await gracefullyShutdownChild(child, {
    platform: 'win32',
    graceTimeoutMs: 1,
    forceTerminate: async () => {
      sequence.push('force');
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(sequence, ['stdin.end', 'force']);
});

test('Unix graceful shutdown still cleans the detached process group after the leader exits', async () => {
  const child = new FakeChild();
  const processSignals = [];
  child.stdin.end = () => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };

  const result = await gracefullyShutdownChild(child, {
    platform: 'linux',
    graceTimeoutMs: 10,
    forceTerminate: (target) =>
      forceTerminateProcessTree(target, {
        platform: 'linux',
        processKill: (pid, signal) => {
          processSignals.push([pid, signal]);
          if (signal === 0) throw new Error('group exited');
        },
        settleTimeoutMs: 1,
      }),
  });

  assert.equal(result, true);
  assert.deepEqual(processSignals, [
    [-4242, 'SIGTERM'],
    [-4242, 0],
  ]);
});

test('Windows forced termination uses the absolute taskkill path and process-tree flags', async () => {
  const child = new FakeChild();
  const calls = [];
  const result = await forceTerminateProcessTree(child, {
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows' },
    runTaskkill: async (...args) => {
      calls.push(args);
      child.exitCode = 1;
      child.emit('exit', 1, null);
    },
    settleTimeoutMs: 10,
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    [
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '4242', '/t', '/f'],
      { timeout: 5_000, windowsHide: true },
    ],
  ]);
});
