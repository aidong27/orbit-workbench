import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import {
  buildSmokeChildEnvironment,
  gracefullyShutdownChild,
  resolveGrokBinary,
  windowsJobRunnerCommand,
} from './smoke-acp-helpers.mjs';

const binary = await resolveGrokBinary();
if (!binary) throw new Error('未找到 Grok Build CLI。');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const directCommand = {
  file: binary,
  args: ['--no-auto-update', 'agent', 'stdio'],
};
const command =
  process.platform === 'win32'
    ? windowsJobRunnerCommand(
        fileURLToPath(new URL('../build/windows-job-runner.exe', import.meta.url)),
        process.pid,
        directCommand,
      )
    : directCommand;
const child = spawn(command.file, command.args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: buildSmokeChildEnvironment(process.env),
  windowsHide: true,
  detached: process.platform !== 'win32',
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000);
});

const timeout = (promise, label, milliseconds = 20_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const client = {
  requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  sessionUpdate: async () => undefined,
};

const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
const connection = new acp.ClientSideConnection(() => client, stream);

try {
  const initialized = await timeout(
    connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: 'orbit-workbench-smoke',
        title: '星轨工作台 ACP 冒烟测试',
        version: packageJson.version,
      },
    }),
    'initialize',
  );

  const authMethods = initialized.authMethods ?? [];
  const cached =
    authMethods.find((method) => method.id === 'cached_token') ??
    authMethods.find((method) => method.id.includes('cached'));
  if (cached) {
    await timeout(
      connection.authenticate({ methodId: cached.id, _meta: { headless: true } }),
      'authenticate',
    );
  }

  const session = await timeout(
    connection.newSession({ cwd: process.cwd(), mcpServers: [] }),
    'session/new',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        protocolVersion: initialized.protocolVersion,
        agent: initialized.agentInfo ?? null,
        sessionId: session.sessionId,
        modes: session.modes ?? null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(stderr.trim() || message);
  process.exitCode = 1;
} finally {
  const closed = await gracefullyShutdownChild(child);
  if (!closed) {
    console.error('无法确认 Grok ACP 冒烟测试进程已结束。');
    process.exitCode = 1;
  }
}
