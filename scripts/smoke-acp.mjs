import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const binary = process.env.GROK_BINARY || join(homedir(), '.grok', 'bin', 'grok');
await access(binary);

const child = spawn(binary, ['--no-auto-update', 'agent', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000);
});

const timeout = (promise, label, milliseconds = 20_000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds),
    ),
  ]);

const client = {
  requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  sessionUpdate: async () => undefined,
};

const stream = acp.ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
);
const connection = new acp.ClientSideConnection(() => client, stream);

try {
  const initialized = await timeout(
    connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: 'orbit-workbench-smoke',
        title: '星轨工作台 ACP 冒烟测试',
        version: '0.1.0-alpha.1',
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
  child.kill();
}
