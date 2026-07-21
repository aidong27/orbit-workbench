import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const electronRoot = dirname(require.resolve('electron/package.json'));
const chromiumLicense = join(electronRoot, 'dist', 'LICENSES.chromium.html');

if (!existsSync(chromiumLicense)) {
  execFileSync(process.execPath, [join(electronRoot, 'install.js')], {
    stdio: 'inherit',
  });
}

if (!existsSync(chromiumLicense) || statSync(chromiumLicense).size === 0) {
  throw new Error('Electron runtime is missing LICENSES.chromium.html after installation');
}
