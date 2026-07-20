import { contextBridge, ipcRenderer } from 'electron';
import type {
  AcpSessionEvent,
  GrokConnectionEvent,
  GrokDesktopApi,
  PermissionRequestEvent,
  PermissionResolution,
} from '../shared/types';

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const wrapped = (_electronEvent: Electron.IpcRendererEvent, payload: T): void =>
    listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: GrokDesktopApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  chooseDirectory: () => ipcRenderer.invoke('workspace:choose'),
  inspectProject: (path) => ipcRenderer.invoke('workspace:inspect', path),
  checkGrok: () => ipcRenderer.invoke('grok:check'),
  connectGrok: () => ipcRenderer.invoke('grok:connect'),
  createSession: (cwd) => ipcRenderer.invoke('grok:create-session', cwd),
  sendPrompt: (sessionId, text) => ipcRenderer.invoke('grok:send-prompt', sessionId, text),
  cancelSession: (sessionId) => ipcRenderer.invoke('grok:cancel-session', sessionId),
  setSessionMode: (sessionId, modeId) => ipcRenderer.invoke('grok:set-mode', sessionId, modeId),
  resolvePermission: (resolution: PermissionResolution) =>
    ipcRenderer.invoke('grok:resolve-permission', resolution),
  onSessionUpdate: (listener) => subscribe<AcpSessionEvent>('grok:session-update', listener),
  onPermissionRequest: (listener) =>
    subscribe<PermissionRequestEvent>('grok:permission-request', listener),
  onConnectionEvent: (listener) =>
    subscribe<GrokConnectionEvent>('grok:connection-event', listener),
};

contextBridge.exposeInMainWorld('grokDesktop', api);
