export type ConnectionStatus = 'checking' | 'ready' | 'offline' | 'error';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'working'
  | 'awaiting_permission'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
}

export interface GrokStatus {
  status: ConnectionStatus;
  binaryPath: string | null;
  version: string | null;
  authenticated: boolean | null;
  detail?: string;
}

export interface ProjectSummary {
  path: string;
  name: string;
  branch: string | null;
  isGitRepository: boolean;
  changedFiles: number;
  statusLines: string[];
  diffStat: string;
}

export interface SessionModeOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface CreatedSession {
  sessionId: string;
  currentModeId: string | null;
  availableModes: SessionModeOption[];
}

export interface PromptResult {
  sessionId: string;
  stopReason: string;
  usage?: unknown;
}

export interface AcpSessionEvent {
  sessionId: string;
  update: Record<string, unknown> & { sessionUpdate: string };
}

export interface GrokConnectionEvent {
  status: ConnectionStatus;
  detail?: string;
  agentName?: string;
  agentVersion?: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequestEvent {
  requestId: string;
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: PermissionOption[];
}

export interface PermissionResolution {
  requestId: string;
  optionId?: string;
  cancelled?: boolean;
}

export interface GrokDesktopApi {
  getAppInfo(): Promise<AppInfo>;
  chooseDirectory(): Promise<ProjectSummary | null>;
  inspectProject(path: string): Promise<ProjectSummary>;
  checkGrok(): Promise<GrokStatus>;
  connectGrok(): Promise<GrokConnectionEvent>;
  createSession(cwd: string): Promise<CreatedSession>;
  sendPrompt(sessionId: string, text: string): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  setSessionMode(sessionId: string, modeId: string): Promise<void>;
  resolvePermission(resolution: PermissionResolution): Promise<void>;
  onSessionUpdate(listener: (event: AcpSessionEvent) => void): () => void;
  onPermissionRequest(listener: (event: PermissionRequestEvent) => void): () => void;
  onConnectionEvent(listener: (event: GrokConnectionEvent) => void): () => void;
}
