import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type OpenDialogOptions,
  screen,
  session,
  shell,
} from 'electron';
import type { ProjectSummary } from '../shared/types';
import { isAllowedExternalUrl } from '../shared/url';
import { parsePorcelainV1Z } from './git-status';
import { classifyConnectionIssue, GrokAcpManager, inspectGrokBinary } from './grok-acp';
import { permissionResolution, requiredString } from './ipc-validation';
import { contentSecurityPolicy, isTrustedMainFrame } from './security';
import { windowSizeForWorkArea } from './window-sizing';

const execFileAsync = promisify(execFile);
const APP_ID = 'cn.aidong27.orbit-workbench';
const SMOKE_TEST = process.argv.includes('--smoke-test');
const SMOKE_REPORT_USER_DATA = SMOKE_TEST && process.argv.includes('--smoke-report-user-data');
const SMOKE_USER_DATA_PREFIX = 'ORBIT_SMOKE_USER_DATA_BASE64:';
const windowsJobRunnerPath =
  process.platform === 'win32'
    ? app.isPackaged
      ? join(process.resourcesPath, 'windows-job-runner.exe')
      : join(app.getAppPath(), 'build', 'windows-job-runner.exe')
    : null;
const grok = new GrokAcpManager(app.getVersion(), windowsJobRunnerPath);
const trustedWebContentsIds = new Set<number>();
let smokeTestFinished = false;
let smokeTestTimer: NodeJS.Timeout | null = null;

function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!isTrustedMainFrame(trustedWebContentsIds.has(event.sender.id), senderFrame, mainFrame)) {
    throw new Error('已拒绝来自非受信任窗口的请求。');
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout.trimEnd();
}

async function validateDirectory(input: unknown): Promise<string> {
  const inputPath = requiredString(input, '工作区路径', 32_768);
  if (!isAbsolute(inputPath)) throw new Error('工作区路径必须是绝对路径。');
  const resolved = await realpath(inputPath);
  const details = await stat(resolved);
  if (!details.isDirectory()) throw new Error('所选路径不是文件夹。');
  return resolved;
}

async function inspectProject(inputPath: unknown): Promise<ProjectSummary> {
  const path = await validateDirectory(inputPath);
  const nonGitProject = (): ProjectSummary => ({
    path,
    name: basename(path),
    branch: null,
    isGitRepository: false,
    changedFiles: 0,
    statusLines: [],
    diffStat: '',
  });

  try {
    await runGit(path, ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    const details = error as { code?: unknown; stderr?: unknown; killed?: boolean };
    if (details.code === 'ENOENT') throw new Error('未找到 Git，请先安装 Git 并重新打开工作区。');
    const stderr = typeof details.stderr === 'string' ? details.stderr : '';
    if (stderr.toLowerCase().includes('not a git repository')) return nonGitProject();
    if (details.killed) throw new Error('读取 Git 仓库超时。');
    throw new Error(stderr.trim() || '无法确认工作区的 Git 状态。');
  }

  const [branch, status, unstaged, staged] = await Promise.all([
    runGit(path, ['branch', '--show-current']),
    runGit(path, ['status', '--porcelain=v1', '-z']),
    runGit(path, ['diff', '--stat']),
    runGit(path, ['diff', '--cached', '--stat']),
  ]).catch((error: unknown) => {
    const details = error as { stderr?: unknown; killed?: boolean };
    if (details.killed) throw new Error('读取 Git 状态超时。');
    throw new Error(
      typeof details.stderr === 'string' && details.stderr.trim()
        ? details.stderr.trim()
        : '无法读取 Git 工作区状态。',
    );
  });
  const statusLines = parsePorcelainV1Z(status);
  return {
    path,
    name: basename(path),
    branch: branch || 'HEAD',
    isGitRepository: true,
    changedFiles: statusLines.length,
    statusLines,
    diffStat: [unstaged, staged].filter(Boolean).join('\n'),
  };
}

function createWindow(): BrowserWindow {
  const windowSize = windowSizeForWorkArea(
    process.platform,
    screen.getPrimaryDisplay().workAreaSize,
  );
  const windowOptions: BrowserWindowConstructorOptions = {
    ...windowSize,
    show: false,
    backgroundColor: '#141414',
    title: '星轨工作台',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  };
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 15 };
  } else {
    windowOptions.autoHideMenuBar = true;
  }
  const window = new BrowserWindow(windowOptions);
  const webContentsId = window.webContents.id;

  trustedWebContentsIds.add(webContentsId);
  const unregister = grok.registerWebContents(window.webContents);
  let rendererLoaded = false;
  window.webContents.on('did-finish-load', () => {
    rendererLoaded = true;
  });
  window.webContents.on('did-start-loading', () => {
    if (!rendererLoaded) return;
    rendererLoaded = false;
    grok.releaseSessionsForWebContents(webContentsId);
  });
  window.webContents.on('render-process-gone', () => {
    rendererLoaded = false;
    grok.releaseSessionsForWebContents(webContentsId);
  });
  window.on('closed', () => {
    unregister();
    trustedWebContentsIds.delete(webContentsId);
  });
  window.once('ready-to-show', () => {
    if (!SMOKE_TEST) window.show();
  });
  if (SMOKE_TEST) {
    window.webContents.once('did-fail-load', (_event, code, description) => {
      failSmokeTest(`Renderer load failed (${code}): ${description}`);
    });
    window.webContents.once('render-process-gone', (_event, details) => {
      failSmokeTest(`Renderer process exited: ${details.reason}`);
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle('app:renderer-ready', (event) => {
    assertTrustedSender(event);
    if (!SMOKE_TEST || smokeTestFinished) return;
    smokeTestFinished = true;
    if (smokeTestTimer) clearTimeout(smokeTestTimer);
    console.error('[smoke-test] Renderer and preload handshake passed.');
    setTimeout(() => process.exit(0), 100);
  });

  ipcMain.handle('app:info', (event) => {
    assertTrustedSender(event);
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle('workspace:choose', async (event) => {
    assertTrustedSender(event);
    const active = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: '选择 Grok Build 工作区',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '打开工作区',
    };
    const result = active
      ? await dialog.showOpenDialog(active, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    return result.canceled || !selected ? null : inspectProject(selected);
  });
  ipcMain.handle('workspace:inspect', (event, path: unknown) => {
    assertTrustedSender(event);
    return inspectProject(path);
  });

  ipcMain.handle('grok:check', (event) => {
    assertTrustedSender(event);
    return inspectGrokBinary();
  });
  ipcMain.handle('grok:connect', async (event) => {
    assertTrustedSender(event);
    try {
      return await grok.connect();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '连接 Grok Build 失败。';
      return { status: 'error' as const, detail, ...classifyConnectionIssue(detail) };
    }
  });
  ipcMain.handle('grok:create-session', (event, cwd: unknown) => {
    assertTrustedSender(event);
    return validateDirectory(cwd).then((safeCwd) => grok.createSession(safeCwd, event.sender.id));
  });
  ipcMain.handle('grok:send-prompt', (event, sessionId: unknown, text: unknown) => {
    assertTrustedSender(event);
    const safeSessionId = requiredString(sessionId, '会话 ID', 256);
    const prompt = requiredString(text, '任务内容', 200_000).trim();
    return grok.sendPrompt(safeSessionId, prompt, event.sender.id);
  });
  ipcMain.handle('grok:cancel-session', (event, sessionId: unknown) => {
    assertTrustedSender(event);
    return grok.cancelSession(requiredString(sessionId, '会话 ID', 256), event.sender.id);
  });
  ipcMain.handle('grok:set-mode', (event, sessionId: unknown, modeId: unknown) => {
    assertTrustedSender(event);
    return grok.setSessionMode(
      requiredString(sessionId, '会话 ID', 256),
      requiredString(modeId, '模式 ID', 256),
      event.sender.id,
    );
  });
  ipcMain.handle('grok:resolve-permission', (event, resolution: unknown) => {
    assertTrustedSender(event);
    return grok.resolvePermission(permissionResolution(resolution), event.sender.id);
  });
}

function failSmokeTest(message: string): void {
  if (!SMOKE_TEST || smokeTestFinished) return;
  smokeTestFinished = true;
  if (smokeTestTimer) clearTimeout(smokeTestTimer);
  console.error(`[smoke-test] ${message}`);
  process.exit(1);
}

function startSmokeTestTimeout(): void {
  if (!SMOKE_TEST) return;
  console.error('[smoke-test] Waiting for renderer and preload handshake.');
  smokeTestTimer = setTimeout(
    () => failSmokeTest('Renderer/preload handshake timed out after 20 seconds.'),
    20_000,
  );
}

function reportSmokeTestUserDataPath(): void {
  if (!SMOKE_REPORT_USER_DATA) return;
  const encodedPath = Buffer.from(app.getPath('userData'), 'utf8').toString('base64');
  console.log(`${SMOKE_USER_DATA_PREFIX}${encodedPath}`);
}

function configureSecurityHeaders(): void {
  const policy = contentSecurityPolicy(app.isPackaged);
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

app.setAppUserModelId(APP_ID);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    configureSecurityHeaders();
    registerIpc();
    startSmokeTestTimeout();
    reportSmokeTestUserDataPath();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    return;
  }
  void grok.disconnect().catch(() => undefined);
});

let shutdownStarted = false;
app.on('before-quit', (event) => {
  if (SMOKE_TEST) return;
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  void grok.shutdown().then(
    () => app.quit(),
    () => {
      console.error('[shutdown] Local agent cleanup did not confirm after retry; exiting the app.');
      app.quit();
    },
  );
});
