import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, shell } from 'electron';
import type { PermissionResolution, ProjectSummary } from '../shared/types';
import { GrokAcpManager, inspectGrokBinary } from './grok-acp';

const execFileAsync = promisify(execFile);
const grok = new GrokAcpManager();

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout.trimEnd();
}

async function validateDirectory(inputPath: string): Promise<string> {
  if (!inputPath || !isAbsolute(inputPath)) throw new Error('工作区路径必须是绝对路径。');
  const resolved = await realpath(inputPath);
  const details = await stat(resolved);
  if (!details.isDirectory()) throw new Error('所选路径不是文件夹。');
  return resolved;
}

async function inspectProject(inputPath: string): Promise<ProjectSummary> {
  const path = await validateDirectory(inputPath);
  try {
    await runGit(path, ['rev-parse', '--is-inside-work-tree']);
    const [branch, status, unstaged, staged] = await Promise.all([
      runGit(path, ['branch', '--show-current']),
      runGit(path, ['status', '--short']),
      runGit(path, ['diff', '--stat']),
      runGit(path, ['diff', '--cached', '--stat']),
    ]);
    const statusLines = status ? status.split('\n') : [];
    return {
      path,
      name: basename(path),
      branch: branch || 'HEAD',
      isGitRepository: true,
      changedFiles: statusLines.length,
      statusLines,
      diffStat: [unstaged, staged].filter(Boolean).join('\n'),
    };
  } catch {
    return {
      path,
      name: basename(path),
      branch: null,
      isGitRepository: false,
      changedFiles: 0,
      statusLines: [],
      diffStat: '',
    };
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#141414',
    title: '星轨工作台',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: new URL('../preload/index.mjs', import.meta.url).pathname,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const unregister = grok.registerWebContents(window.webContents);
  window.on('closed', unregister);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(new URL('../renderer/index.html', import.meta.url).pathname);
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('workspace:choose', async () => {
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
  ipcMain.handle('workspace:inspect', (_event, path: string) => inspectProject(path));

  ipcMain.handle('grok:check', () => inspectGrokBinary());
  ipcMain.handle('grok:connect', () => grok.connect());
  ipcMain.handle('grok:create-session', (_event, cwd: string) =>
    validateDirectory(cwd).then((safeCwd) => grok.createSession(safeCwd)),
  );
  ipcMain.handle('grok:send-prompt', (_event, sessionId: string, text: string) => {
    const prompt = text.trim();
    if (!sessionId || !prompt) throw new Error('会话与任务内容不能为空。');
    return grok.sendPrompt(sessionId, prompt);
  });
  ipcMain.handle('grok:cancel-session', (_event, sessionId: string) =>
    grok.cancelSession(sessionId),
  );
  ipcMain.handle('grok:set-mode', (_event, sessionId: string, modeId: string) =>
    grok.setSessionMode(sessionId, modeId),
  );
  ipcMain.handle('grok:resolve-permission', (_event, resolution: PermissionResolution) =>
    grok.resolvePermission(resolution),
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => grok.stop());
