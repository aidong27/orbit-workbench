import type {
  AcpSessionEvent,
  GrokConnectionEvent,
  GrokDesktopApi,
  PermissionClearedEvent,
  PermissionRequestEvent,
} from '../../../shared/types';
import { shouldUseBrowserPreview } from './runtime';

const sessionListeners = new Set<(event: AcpSessionEvent) => void>();
const permissionListeners = new Set<(event: PermissionRequestEvent) => void>();
const permissionClearedListeners = new Set<(event: PermissionClearedEvent) => void>();
const connectionListeners = new Set<(event: GrokConnectionEvent) => void>();

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const previewIsWindows = navigator.userAgent.includes('Windows');
const previewPlatform = previewIsWindows ? 'win32' : 'darwin';
const previewArch = previewIsWindows ? 'x64' : 'arm64';
const previewHome = previewIsWindows ? 'C:\\Users\\demo' : '/Users/demo';

function emitSession(event: AcpSessionEvent): void {
  for (const listener of sessionListeners) listener(event);
}

const browserPreviewApi: GrokDesktopApi = {
  reportRendererReady: async () => undefined,
  getAppInfo: async () => ({
    version: '0.2.0-alpha.1',
    platform: previewPlatform,
    arch: previewArch,
    isPackaged: false,
  }),
  chooseDirectory: async () => ({
    path: previewIsWindows
      ? 'C:\\Users\\demo\\Projects\\orbit-console'
      : '/Users/demo/Projects/orbit-console',
    name: 'orbit-console',
    branch: 'main',
    isGitRepository: true,
    changedFiles: 0,
    statusLines: [],
    diffStat: '',
  }),
  inspectProject: async (path) => ({
    path,
    name: path.split(/[\\/]/u).at(-1) ?? 'workspace',
    branch: 'main',
    isGitRepository: true,
    changedFiles: 0,
    statusLines: [],
    diffStat: '',
  }),
  checkGrok: async () => ({
    status: 'ready',
    binaryPath: previewIsWindows
      ? `${previewHome}\\.grok\\bin\\grok.exe`
      : `${previewHome}/.grok/bin/grok`,
    version: 'grok 0.2.99（浏览器预览）',
    authenticated: true,
  }),
  connectGrok: async () => ({
    status: 'ready',
    detail: '浏览器界面预览模式',
    agentName: 'Grok Build',
    agentVersion: '0.2.99',
  }),
  createSession: async () => ({
    sessionId: crypto.randomUUID(),
    currentModeId: 'normal',
    availableModes: [
      { id: 'normal', name: '普通', description: '默认协作模式' },
      { id: 'plan', name: '计划', description: '先审阅计划，再执行改动' },
      { id: 'always-approve', name: '始终批准', description: '自动批准工具调用' },
    ],
  }),
  sendPrompt: async (sessionId, text) => {
    await wait(250);
    emitSession({
      sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '正在检查工作区结构与相关文件。' },
      },
    });
    await wait(350);
    emitSession({
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'preview-search',
        title: '搜索相关实现',
        kind: 'search',
        status: 'in_progress',
        rawInput: { query: text.slice(0, 48) },
      },
    });
    await wait(450);
    emitSession({
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'preview-search',
        status: 'completed',
        rawOutput: '已定位 4 个相关文件',
      },
    });
    const chunks = [
      '这是浏览器里的界面预览响应。',
      '\n\n在打包后的桌面应用中，',
      '同一位置会实时显示本机 Grok Build 的 ACP 输出。',
    ];
    for (const chunk of chunks) {
      await wait(220);
      emitSession({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: chunk },
        },
      });
    }
    await wait(180);
    emitSession({
      sessionId,
      update: { sessionUpdate: 'client_turn_complete', stopReason: 'end_turn' },
    });
    return { sessionId, stopReason: 'end_turn' };
  },
  cancelSession: async (sessionId) => {
    emitSession({
      sessionId,
      update: { sessionUpdate: 'client_turn_complete', stopReason: 'cancelled' },
    });
  },
  setSessionMode: async (sessionId, modeId) => {
    emitSession({
      sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: modeId },
    });
  },
  resolvePermission: async () => undefined,
  onSessionUpdate: (listener) => {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },
  onPermissionRequest: (listener) => {
    permissionListeners.add(listener);
    return () => permissionListeners.delete(listener);
  },
  onPermissionCleared: (listener) => {
    permissionClearedListeners.add(listener);
    return () => permissionClearedListeners.delete(listener);
  },
  onConnectionEvent: (listener) => {
    connectionListeners.add(listener);
    return () => connectionListeners.delete(listener);
  },
};

export const isBrowserPreview = shouldUseBrowserPreview(
  Boolean(window.grokDesktop),
  import.meta.env.DEV,
  navigator.userAgent,
);

function resolveDesktopApi(): GrokDesktopApi {
  if (window.grokDesktop) return window.grokDesktop;
  if (isBrowserPreview) return browserPreviewApi;
  throw new Error('Electron 安全桥接未加载，应用已停止以避免显示伪造状态。');
}

export const desktopApi = resolveDesktopApi();
