import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = await readFile(
  new URL('../.github/workflows/platform-packages.yml', import.meta.url),
  'utf8',
);
const verifier = await readFile(new URL('./verify-windows-package.ps1', import.meta.url), 'utf8');
const mainProcess = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const jobRunnerSource = await readFile(
  new URL('../native/windows-job-runner.c', import.meta.url),
  'utf8',
);
const jobRunner = await readFile(new URL('../build/windows-job-runner.exe', import.meta.url));
const expectedJobRunnerHash = 'eef8c5061b96a5ba76c3fd980c718761a7d269cc13def4fe23006df358054443';

function assert(condition, message) {
  if (!condition) throw new Error(`Windows package config: ${message}`);
}

const build = packageJson.build ?? {};
const windows = build.win ?? {};
const nsis = build.nsis ?? {};
const portable = build.portable ?? {};
const fuses = build.electronFuses ?? {};
const targets = Array.isArray(windows.target) ? windows.target : [];
const targetByName = new Map(targets.map((target) => [target.target, target]));

function peHeader(buffer) {
  assert(buffer.length >= 70, 'Windows Job Object runner is too short');
  assert(buffer.readUInt16LE(0) === 0x5a4d, 'Windows Job Object runner has no DOS header');
  const peOffset = buffer.readUInt32LE(0x3c);
  assert(
    peOffset > 0 && peOffset <= buffer.length - 26,
    'Windows Job Object runner has an invalid PE offset',
  );
  assert(
    buffer.readUInt32LE(peOffset) === 0x0000_4550,
    'Windows Job Object runner has no PE signature',
  );
  return {
    machine: buffer.readUInt16LE(peOffset + 4),
    optionalMagic: buffer.readUInt16LE(peOffset + 24),
  };
}

assert(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageJson.version),
  `unsupported version '${packageJson.version}'`,
);
assert(build.productName === '星轨工作台', 'unexpected localized product name');
assert(packageJson.name === 'orbit-workbench', 'package name must remain orbit-workbench');
assert(build.appId === 'cn.aidong27.orbit-workbench', 'unexpected Windows application ID');
assert(build.asar === true, 'packaged application code must remain inside ASAR');
assert(build.directories?.output === 'release', 'package output directory must remain release');
assert(
  JSON.stringify(build.files) === JSON.stringify(['out/**/*', 'package.json']),
  'package file allowlist must contain only built output and package metadata',
);
for (const [source, destination] of [
  ['LICENSE', 'LICENSE.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt'],
  ['node_modules/electron/dist/LICENSES.chromium.html', 'THIRD_PARTY_LICENSES.chromium.html'],
]) {
  assert(
    build.extraResources?.some(
      (resource) => resource.from === source && resource.to === destination,
    ),
    `packaged Windows payload is missing ${destination}`,
  );
}
for (const [fuse, expected] of Object.entries({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
})) {
  assert(fuses[fuse] === expected, `Electron fuse '${fuse}' is not hardened`);
}
assert(windows.executableName === 'Orbit Workbench', 'unexpected executable name');
assert(windows.icon === 'build/icon.ico', 'Windows executable icon must use the project icon');
assert(
  windows.extraResources?.some(
    (resource) =>
      resource.from === 'build/windows-job-runner.exe' && resource.to === 'windows-job-runner.exe',
  ),
  'Windows Job Object runner is not packaged as a Windows-only resource',
);
assert(targetByName.size === 2, 'expected only NSIS and Portable targets');
for (const targetName of ['nsis', 'portable']) {
  const target = targetByName.get(targetName);
  assert(target, `missing ${targetName} target`);
  assert(
    Array.isArray(target.arch) && target.arch.length === 1 && target.arch[0] === 'x64',
    `${targetName} target must build Windows x64 only`,
  );
}

assert(
  nsis.artifactName === `Orbit-Workbench-\${version}-Windows-\${arch}-Setup.\${ext}`,
  'NSIS artifact name is unstable',
);
assert(
  portable.artifactName === `Orbit-Workbench-\${version}-Windows-\${arch}-Portable.\${ext}`,
  'Portable artifact name is unstable',
);
assert(nsis.oneClick === false, 'installer must remain assisted');
assert(nsis.unicode === true, 'installer must remain Unicode');
assert(nsis.warningsAsErrors === true, 'NSIS warnings must fail the build');
assert(
  nsis.allowToChangeInstallationDirectory === true,
  'custom install paths must remain enabled',
);
assert(nsis.createDesktopShortcut === true, 'desktop shortcut must remain enabled');
assert(nsis.createStartMenuShortcut === true, 'start menu shortcut must remain enabled');
assert(nsis.shortcutName === '星轨工作台', 'shortcut name must remain localized');
assert(nsis.uninstallDisplayName === '星轨工作台', 'uninstall display name must remain localized');
assert(nsis.deleteAppDataOnUninstall === false, 'uninstall must preserve user history by default');
assert(nsis.installerIcon === 'build/icon.ico', 'installer icon must use the project icon');
assert(nsis.uninstallerIcon === 'build/icon.ico', 'uninstaller icon must use the project icon');
assert(
  packageJson.scripts?.['verify:win-package']?.includes('verify-windows-package.ps1'),
  'verify:win-package script is missing',
);
assert(
  workflow.includes('run: pnpm verify:win-package'),
  'package workflow does not run the Windows verifier',
);
assert(
  workflow.includes(
    'pnpm verify:win-job -- --runner release/win-unpacked/resources/windows-job-runner.exe',
  ),
  'package workflow does not execute the packaged Windows Job Object runner',
);
assert(
  workflow.includes('Get-Content package.json -Raw | ConvertFrom-Json') &&
    workflow.includes('WINDOWS_SETUP_ARTIFACT=$setupName') &&
    workflow.includes('WINDOWS_PORTABLE_ARTIFACT=$portableName') &&
    workflow.includes('steps.windows-artifacts.outputs.setup_path') &&
    workflow.includes('steps.windows-artifacts.outputs.portable_path'),
  'package workflow does not derive and upload exact artifact paths from package.json',
);
assert(
  !workflow.includes('release/*.exe'),
  'package workflow must not upload wildcard executables',
);
assert(
  workflow.includes('if: always()') && workflow.includes('orbit-workbench-windows-x64-diagnostics'),
  'package workflow does not retain failure diagnostics',
);
assert(
  workflow.includes('CSC_IDENTITY_AUTO_DISCOVERY: "false"'),
  'unsigned Alpha package job must not auto-discover an unrelated signing identity',
);
assert(
  workflow.includes('$buildExitCode = $LASTEXITCODE') &&
    workflow.includes('Windows package build failed with exit code'),
  'Windows package job does not preserve the native builder exit code through Tee-Object',
);
assert(
  workflow.includes('[System.Management.Automation.Language.Parser]::ParseFile(') &&
    workflow.includes('$parseErrors.Count -gt 0'),
  'Windows package job does not parse-check the PowerShell verifier before building',
);
assert(!/@v\d+/u.test(workflow), 'platform package actions must be pinned to commit SHAs');
for (const action of ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']) {
  assert(
    new RegExp(`${action.replace('/', '\\/')}@[0-9a-f]{40}(?:\\s|$)`, 'u').test(workflow),
    `${action} is not pinned to a full commit SHA`,
  );
}
for (const contract of [
  'Orbit Workbench CI-',
  '中文 安装目录',
  '中文 便携目录',
  '星轨工作台 便携验证.exe',
  'Get-UninstallEntries',
  'Get-UninstallEntriesForInstall',
  'Assert-NoProductProcesses',
  'Get-SystemTaskkillPath',
  'Get-PeMachine',
  '$peMachine -eq 0x8664',
  '[System.EnvironmentVariableTarget]::Machine',
  'Refusing to run destructive package verification',
  'Remove-TestShortcut',
  'Refusing to remove a shortcut that no longer targets the test install',
  'Remove-TestInstallation',
  'Refusing to clean an unexpected verification root',
  'BaselineProcessCount',
  '--smoke-report-user-data',
  'ORBIT_SMOKE_USER_DATA_BASE64:',
  'Get-SmokeReportedUserDataPath',
  'Installed uninstaller display icon',
  '$shortcut.Arguments',
  'User data preservation sentinel: retained after uninstall',
  'SHA256SUMS-Windows-x64.txt',
  'windows-job-runner.exe',
  expectedJobRunnerHash,
]) {
  assert(verifier.includes(contract), `Windows verifier lost contract '${contract}'`);
}
assert(
  !verifier.includes('& taskkill.exe') && verifier.includes('& $taskkillPath'),
  'Windows verifier must invoke taskkill from the resolved System32 path',
);
assert(
  verifier.includes('Get-ChildItem -LiteralPath $releasePath -Filter "*.exe" -File'),
  'Windows verifier does not reject every unexpected root executable',
);
assert(
  verifier.includes('$versionInfo.FileVersion -eq $ExpectedVersion') &&
    verifier.includes('$versionInfo.ProductVersion -eq $expectedProductVersion'),
  'Windows verifier does not enforce electron-builder file and product versions',
);
assert(
  verifier.includes('$manifestLines.Count -eq 2') &&
    verifier.includes('$manifestNames.Add($manifestName)') &&
    verifier.includes('$manifestNames.Contains($expectedInstallerName)') &&
    verifier.includes('$manifestNames.Contains($expectedPortableName)'),
  'Windows verifier does not reread and strictly validate the exact checksum manifest',
);
assert(
  verifier.includes('QuietUninstallString') &&
    verifier.includes('@("/currentuser", "/S")') &&
    verifier.includes('$userDataSentinel -PathType Leaf'),
  'Windows verifier does not test the registered silent current-user uninstaller and preserved data',
);
assert(
  mainProcess.includes("process.argv.includes('--smoke-report-user-data')") &&
    mainProcess.includes("const SMOKE_USER_DATA_PREFIX = 'ORBIT_SMOKE_USER_DATA_BASE64:'") &&
    mainProcess.includes("Buffer.from(app.getPath('userData'), 'utf8').toString('base64')"),
  'main process does not expose the fixed stdout-only smoke userData report',
);
assert(
  mainProcess.includes("join(process.resourcesPath, 'windows-job-runner.exe')") &&
    mainProcess.includes("join(app.getAppPath(), 'build', 'windows-job-runner.exe')"),
  'main process does not resolve the packaged and development Job Object runner paths',
);
for (const contract of [
  'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
  'JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION',
  'CREATE_SUSPENDED',
  'AssignProcessToJobObject',
  'WaitForMultipleObjects',
  'OpenProcess(SYNCHRONIZE',
  'TerminateJobObject',
]) {
  assert(
    jobRunnerSource.includes(contract),
    `Windows Job Object source lost safety contract '${contract}'`,
  );
}
const jobRunnerHeader = peHeader(jobRunner);
assert(jobRunnerHeader.machine === 0x8664, 'Windows Job Object runner is not x64');
assert(jobRunnerHeader.optionalMagic === 0x020b, 'Windows Job Object runner is not PE32+');
assert(
  createHash('sha256').update(jobRunner).digest('hex') === expectedJobRunnerHash,
  'Windows Job Object runner SHA-256 does not match the reviewed source build',
);
assert(
  !mainProcess.includes('--smoke-user-data-path-file=') &&
    !mainProcess.includes('writeFileSync') &&
    !verifier.includes('--smoke-user-data-path-file='),
  'smoke verification must not accept an arbitrary report file path',
);
assert(
  (await stat(new URL('../build/icon.ico', import.meta.url))).size > 0,
  'Windows icon is empty',
);

console.log(
  `Windows package config verified for ${packageJson.version}: NSIS + Portable x64, Unicode assisted installer.`,
);
