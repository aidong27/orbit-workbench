import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = fileURLToPath(
  new URL('../test/fixtures/windows-job-runner-fixture.mjs', import.meta.url),
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function boundedOutput(chunks, label) {
  const output = Buffer.concat(chunks);
  if (output.length > 64 * 1_024) throw new Error(`${label} exceeded 64 KiB.`);
  return output;
}

function runCaptured(file, args, input, timeoutMs = 15_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out running ${file}.`));
    }, timeoutMs);
    timer.unref();
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        signal,
        stdout: boundedOutput(stdout, 'stdout'),
        stderr: boundedOutput(stderr, 'stderr'),
      });
    });
    child.stdin.end(input);
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitForExit(pid, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return !processExists(pid);
}

function systemTaskkillPath() {
  const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  return win32.join(root, 'System32', 'taskkill.exe');
}

const requestedRunner = argumentValue('--runner');
const runnerPath = resolve(
  requestedRunner ?? join(repositoryRoot, 'build', 'windows-job-runner.exe'),
);
if (!isAbsolute(runnerPath) || win32.extname(runnerPath).toLowerCase() !== '.exe') {
  throw new Error('Windows Job Object runner path must be an absolute .exe path.');
}
await readFile(runnerPath);

if (process.platform !== 'win32') {
  console.log(`Windows Job Object runtime test skipped on ${process.platform}: ${runnerPath}`);
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'orbit-windows-job-runner-'));
const descendantPidPath = join(temporaryDirectory, 'descendant.pid');
let descendantPid = null;

try {
  const echoPayload = Buffer.from('ACP stdio proxy: 中文路径 + spaces + "quotes"\\n', 'utf8');
  const echo = await runCaptured(
    runnerPath,
    ['--parent-pid', String(process.pid), '--', process.execPath, fixturePath, 'echo'],
    echoPayload,
  );
  if (echo.code !== 0 || echo.signal !== null) {
    throw new Error(
      `Windows Job Object stdio proxy exited with code=${echo.code} signal=${echo.signal}: ${echo.stderr.toString('utf8')}`,
    );
  }
  if (!echo.stdout.equals(echoPayload)) {
    throw new Error('Windows Job Object runner did not preserve stdio bytes exactly.');
  }
  if (echo.stderr.length !== 0) {
    throw new Error(`Windows Job Object runner produced unexpected stderr: ${echo.stderr}`);
  }

  const descendant = await runCaptured(
    runnerPath,
    [
      '--parent-pid',
      String(process.pid),
      '--',
      process.execPath,
      fixturePath,
      'spawn-descendant',
      descendantPidPath,
    ],
    Buffer.alloc(0),
  );
  if (descendant.code !== 0 || descendant.signal !== null) {
    throw new Error(
      `Windows Job Object descendant test exited with code=${descendant.code} signal=${descendant.signal}: ${descendant.stderr.toString('utf8')}`,
    );
  }
  descendantPid = Number.parseInt(await readFile(descendantPidPath, 'utf8'), 10);
  if (!Number.isSafeInteger(descendantPid) || descendantPid <= 0) {
    throw new Error('Windows Job Object fixture returned an invalid descendant PID.');
  }
  if (!(await waitForExit(descendantPid))) {
    throw new Error(`Windows Job Object left descendant PID ${descendantPid} running.`);
  }

  console.log(
    `Windows Job Object isolation verified: stdio preserved and descendant PID ${descendantPid} terminated.`,
  );
} finally {
  if (descendantPid && processExists(descendantPid)) {
    await execFileAsync(systemTaskkillPath(), ['/pid', String(descendantPid), '/t', '/f'], {
      timeout: 5_000,
      windowsHide: true,
    }).catch(() => undefined);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
