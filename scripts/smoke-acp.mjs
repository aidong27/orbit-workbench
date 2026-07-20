import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';
import * as acp from '@agentclientprotocol/sdk';

const execFileAsync = promisify(execFile);
const pathApi = process.platform === 'win32' ? win32 : posix;
const defaultName = process.platform === 'win32' ? 'grok.exe' : 'grok';
const explicitBinary = process.env.GROK_BINARY?.trim();
const candidates = [
  explicitBinary && pathApi.isAbsolute(explicitBinary) ? explicitBinary : undefined,
  pathApi.join(homedir(), '.grok', 'bin', defaultName),
].filter(Boolean);

let binary = null;
for (const candidate of candidates) {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    binary = candidate;
    break;
  } catch {
    // Continue to PATH lookup.
  }
}

if (!binary) {
  const lookup =
    process.platform === 'win32'
      ? { file: 'where.exe', args: ['grok.exe'] }
      : { file: '/usr/bin/env', args: ['which', 'grok'] };
  try {
    const { stdout } = await execFileAsync(lookup.file, lookup.args, {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
    });
    binary = stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    binary = null;
  }
}

if (!binary) throw new Error('未找到 Grok Build CLI。');
if (process.platform === 'win32' && !binary.toLowerCase().endsWith('.exe')) {
  throw new Error('Windows ACP 冒烟测试需要官方 grok.exe。');
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

const child = spawn(binary, ['--no-auto-update', 'agent', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
  windowsHide: true,
  detached: process.platform !== 'win32',
});

const waitForExit = (milliseconds) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve();
    }, milliseconds);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', onExit);
  });
};

const terminateProcessTree = async () => {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      timeout: 5_000,
      windowsHide: true,
    }).catch(() => child.kill());
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await waitForExit(1_000);
  try {
    process.kill(-child.pid, 0);
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The process group exited during the grace period.
  }
};

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
  await terminateProcessTree();
}
