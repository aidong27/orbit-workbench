import type {
  ConnectionIssueCode,
  ConnectionStatus,
  GrokConnectionEvent,
  GrokStatus,
  PermissionRequestEvent,
  ProjectSummary,
  SessionModeOption,
  SessionStatus,
  UiAcpEvent,
  UiAvailableCommand,
  UiSessionConfigOption,
  UiTurnUsage,
  UiUsage,
} from '../../../shared/types';

export interface WorkspaceProject extends ProjectSummary {
  id: string;
  addedAt: number;
  demo?: boolean;
}

export interface MessageItem {
  id: string;
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string;
  protocolMessageId?: string | null;
  createdAt: number;
  streaming?: boolean;
  error?: boolean;
}

export interface ThoughtItem {
  id: string;
  type: 'thought';
  content: string;
  protocolMessageId?: string | null;
  createdAt: number;
  streaming?: boolean;
}

export interface ToolItem {
  id: string;
  type: 'tool';
  toolCallId: string;
  title: string;
  kind:
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'switch_mode'
    | 'other';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  content?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  createdAt: number;
}

export interface PlanEntry {
  id: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

interface PlanItemBase {
  id: string;
  type: 'plan';
  planId: string | null;
  truncated?: boolean;
  createdAt: number;
}

export type PlanItem =
  | (PlanItemBase & { format: 'items'; entries: PlanEntry[] })
  | (PlanItemBase & { format: 'markdown'; markdown: string })
  | (PlanItemBase & { format: 'file'; uri: string });

export interface StatusItem {
  id: string;
  type: 'status';
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  createdAt: number;
}

export type TimelineItem = MessageItem | ThoughtItem | ToolItem | PlanItem | StatusItem;

export type SessionContinuity = 'fresh' | 'live' | 'local-history-only';
export type ModeSwitchStatus = 'idle' | 'switching' | 'failed';

export interface WorkSession {
  id: string;
  projectId: string;
  title: string;
  acpSessionId: string | null;
  status: SessionStatus;
  timeline: TimelineItem[];
  createdAt: number;
  updatedAt: number;
  continuity: SessionContinuity;
  confirmedModeId: string | null;
  requestedModeId: string | null;
  modeSwitchStatus: ModeSwitchStatus;
  modeSwitchError: string | null;
  modeRequestId: number;
  availableModes: SessionModeOption[];
  availableCommands: UiAvailableCommand[];
  availableCommandsTruncated?: boolean;
  configOptions: UiSessionConfigOption[];
  configOptionsTruncated?: boolean;
  usage?: UiUsage;
  lastTurnUsage?: UiTurnUsage | null;
  demo?: boolean;
}

export type InspectorTab = 'changes' | 'plan' | 'tools' | 'context';

export function sessionBlocksInput(status: SessionStatus): boolean {
  return (
    status === 'working' ||
    status === 'connecting' ||
    status === 'awaiting_permission' ||
    status === 'cancelling'
  );
}

export interface AppState {
  projects: WorkspaceProject[];
  sessions: WorkSession[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  connectionStatus: ConnectionStatus;
  connectionDetail: string;
  connectionAttemptId: number;
  connectionIssueCode: ConnectionIssueCode | null;
  connectionRetryable: boolean;
  grokBinaryPath: string | null;
  grokCliVersion: string | null;
  grokAuthenticated: boolean | null;
  grokAgentName: string | null;
  grokAgentVersion: string | null;
  pendingPermissions: PermissionRequestEvent[];
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  appVersion: string;
  appPlatform: string;
  appArch: string;
}

export type AppAction =
  | { type: 'PROJECT_ADDED'; project: WorkspaceProject }
  | { type: 'PROJECT_UPDATED'; project: WorkspaceProject }
  | { type: 'PROJECT_SELECTED'; projectId: string }
  | { type: 'SESSION_CREATED'; session: WorkSession }
  | { type: 'SESSION_SELECTED'; sessionId: string }
  | {
      type: 'SESSION_CONNECTED';
      localSessionId: string;
      acpSessionId: string;
      currentModeId: string | null;
      availableModes: SessionModeOption[];
      configOptions: UiSessionConfigOption[];
      configOptionsTruncated: boolean;
    }
  | { type: 'SESSION_STATUS'; sessionId: string; status: SessionStatus }
  | { type: 'SESSION_TITLE'; sessionId: string; title: string }
  | { type: 'USER_MESSAGE'; sessionId: string; text: string }
  | { type: 'ACP_EVENT'; sessionId: string; event: UiAcpEvent }
  | {
      type: 'MODE_PREFERENCE_SET';
      sessionId: string;
      modeId: string;
      requestId: number;
    }
  | {
      type: 'MODE_SWITCH_REQUESTED';
      sessionId: string;
      modeId: string;
      requestId: number;
    }
  | {
      type: 'MODE_SWITCH_CONFIRMED';
      sessionId: string;
      modeId: string;
      requestId: number;
    }
  | {
      type: 'MODE_SWITCH_FAILED';
      sessionId: string;
      requestId: number;
      error: string;
    }
  | { type: 'CONNECTION_ATTEMPT'; attemptId: number }
  | { type: 'GROK_INSPECTED'; attemptId: number; result: GrokStatus }
  | { type: 'CONNECTION_RESULT'; attemptId: number; result: GrokConnectionEvent }
  | { type: 'CONNECTION_EVENT'; event: GrokConnectionEvent }
  | { type: 'PERMISSION_REQUEST'; request: PermissionRequestEvent }
  | { type: 'PERMISSION_CLEARED'; requestId: string }
  | { type: 'SIDEBAR_TOGGLED' }
  | { type: 'INSPECTOR_TOGGLED' }
  | { type: 'INSPECTOR_TAB'; tab: InspectorTab }
  | { type: 'COMMAND_PALETTE'; open: boolean }
  | { type: 'SETTINGS'; open: boolean }
  | { type: 'APP_INFO'; version: string; platform: string; arch: string };

export function makeProject(
  summary: ProjectSummary,
  existingProjects: WorkspaceProject[] = [],
): WorkspaceProject {
  const pathKey = workspacePathKey(summary.path);
  const existing = existingProjects.find((project) => workspacePathKey(project.path) === pathKey);
  return {
    ...summary,
    id: existing?.id ?? crypto.randomUUID(),
    addedAt: Date.now(),
  };
}

export function workspacePathKey(path: string): string {
  const windowsLike =
    /^[a-z]:(?:[\\/]|$)/iu.test(path) || path.startsWith('\\\\') || path.startsWith('//');
  let normalized = windowsLike ? path.replaceAll('\\', '/') : path;
  if (/^\/\/\?\/unc\//iu.test(normalized)) {
    normalized = `//${normalized.slice(8)}`;
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice(4);
  }
  normalized = /^\/+$/u.test(normalized) ? '/' : normalized.replace(/\/+$/u, '');
  return windowsLike ? normalized.toLowerCase() : normalized;
}

export function makeSession(projectId: string): WorkSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    projectId,
    title: '新任务',
    acpSessionId: null,
    status: 'idle',
    timeline: [],
    createdAt: now,
    updatedAt: now,
    continuity: 'fresh',
    confirmedModeId: null,
    requestedModeId: null,
    modeSwitchStatus: 'idle',
    modeSwitchError: null,
    modeRequestId: 0,
    availableModes: [],
    availableCommands: [],
    availableCommandsTruncated: false,
    configOptions: [],
    configOptionsTruncated: false,
  };
}
