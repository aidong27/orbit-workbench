import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];

if (mode === 'echo') {
  process.stdin.pipe(process.stdout);
} else if (mode === 'spawn-descendant') {
  const pidFile = process.argv[3];
  if (!pidFile) throw new Error('Missing descendant PID file.');
  const descendant = spawn(process.execPath, [fileURLToPath(import.meta.url), 'wait'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!descendant.pid) throw new Error('Could not start descendant fixture.');
  writeFileSync(pidFile, String(descendant.pid), 'utf8');
  descendant.unref();
} else if (mode === 'wait') {
  setInterval(() => undefined, 1_000);
} else {
  throw new Error(`Unknown Windows Job Object fixture mode: ${mode ?? 'missing'}`);
}
