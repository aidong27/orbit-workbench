import type {
  ConnectionStatus,
  PermissionRequestEvent,
  ProjectSummary,
  SessionModeOption,
  SessionStatus,
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
  createdAt: number;
  streaming?: boolean;
  error?: boolean;
}

export interface ThoughtItem {
  id: string;
  type: 'thought';
  content: string;
  createdAt: number;
  streaming?: boolean;
}

export interface ToolItem {
  id: string;
  type: 'tool';
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  content?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  createdAt: number;
}

export interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanItem {
  id: string;
  type: 'plan';
  entries: PlanEntry[];
  createdAt: number;
}

export interface StatusItem {
  id: string;
  type: 'status';
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  createdAt: number;
}

export type TimelineItem = MessageItem | ThoughtItem | ToolItem | PlanItem | StatusItem;

export interface WorkSession {
  id: string;
  projectId: string;
  title: string;
  acpSessionId: string | null;
  status: SessionStatus;
  timeline: TimelineItem[];
  createdAt: number;
  updatedAt: number;
  currentModeId: string | null;
  availableModes: SessionModeOption[];
  usage?: unknown;
  demo?: boolean;
}

export type InspectorTab = 'changes' | 'plan' | 'tools' | 'context';

export interface AppState {
  projects: WorkspaceProject[];
  sessions: WorkSession[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  connectionStatus: ConnectionStatus;
  connectionDetail: string;
  pendingPermissions: PermissionRequestEvent[];
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  appVersion: string;
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
    }
  | { type: 'SESSION_STATUS'; sessionId: string; status: SessionStatus }
  | { type: 'SESSION_TITLE'; sessionId: string; title: string }
  | { type: 'USER_MESSAGE'; sessionId: string; text: string }
  | { type: 'ACP_UPDATE'; sessionId: string; update: Record<string, unknown> }
  | { type: 'CONNECTION'; status: ConnectionStatus; detail?: string }
  | { type: 'PERMISSION_REQUEST'; request: PermissionRequestEvent }
  | { type: 'PERMISSION_CLEARED'; requestId: string }
  | { type: 'SIDEBAR_TOGGLED' }
  | { type: 'INSPECTOR_TOGGLED' }
  | { type: 'INSPECTOR_TAB'; tab: InspectorTab }
  | { type: 'COMMAND_PALETTE'; open: boolean }
  | { type: 'SETTINGS'; open: boolean }
  | { type: 'APP_VERSION'; version: string };

export function makeProject(
  summary: ProjectSummary,
  existingProjects: WorkspaceProject[] = [],
): WorkspaceProject {
  const existing = existingProjects.find((project) => project.path === summary.path);
  return {
    ...summary,
    id: existing?.id ?? crypto.randomUUID(),
    addedAt: Date.now(),
  };
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
    currentModeId: null,
    availableModes: [],
  };
}
