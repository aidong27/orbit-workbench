import type { AppAction, AppState, PlanEntry, TimelineItem, ToolItem, WorkSession } from './model';

const PERSISTED_STATE_KEY = 'orbit-workbench-state-v1';

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function updateSession(
  state: AppState,
  sessionId: string,
  updater: (session: WorkSession) => WorkSession,
): AppState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? updater(session) : session,
    ),
  };
}

function textFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const value = content as Record<string, unknown>;
  return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
}

function appendAgentChunk(session: WorkSession, chunk: string): WorkSession {
  if (!chunk) return session;
  const timeline = [...session.timeline];
  const last = timeline.at(-1);
  if (last?.type === 'message' && last.role === 'assistant' && last.streaming) {
    timeline[timeline.length - 1] = { ...last, content: `${last.content}${chunk}` };
  } else {
    timeline.push({
      id: nowId('assistant'),
      type: 'message',
      role: 'assistant',
      content: chunk,
      streaming: true,
      createdAt: Date.now(),
    });
  }
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function appendThoughtChunk(session: WorkSession, chunk: string): WorkSession {
  if (!chunk) return session;
  const timeline = [...session.timeline];
  const last = timeline.at(-1);
  if (last?.type === 'thought' && last.streaming) {
    timeline[timeline.length - 1] = { ...last, content: `${last.content}${chunk}` };
  } else {
    timeline.push({
      id: nowId('thought'),
      type: 'thought',
      content: chunk,
      streaming: true,
      createdAt: Date.now(),
    });
  }
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function upsertTool(session: WorkSession, update: Record<string, unknown>): WorkSession {
  const toolCallId = String(update.toolCallId ?? nowId('tool'));
  const index = session.timeline.findIndex(
    (item) => item.type === 'tool' && item.toolCallId === toolCallId,
  );
  const current = index >= 0 ? (session.timeline[index] as ToolItem) : null;
  const next: ToolItem = {
    id: current?.id ?? nowId('tool'),
    type: 'tool',
    toolCallId,
    title: String(update.title ?? current?.title ?? '执行工具'),
    kind: String(update.kind ?? current?.kind ?? 'other'),
    status: String(update.status ?? current?.status ?? 'in_progress'),
    content: update.content ?? current?.content,
    rawInput: update.rawInput ?? current?.rawInput,
    rawOutput: update.rawOutput ?? current?.rawOutput,
    locations: update.locations ?? current?.locations,
    createdAt: current?.createdAt ?? Date.now(),
  };
  const timeline = [...session.timeline];
  if (index >= 0) timeline[index] = next;
  else timeline.push(next);
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function normalizePlanEntries(update: Record<string, unknown>): PlanEntry[] {
  const direct = update.entries;
  const nested =
    update.content && typeof update.content === 'object'
      ? (update.content as Record<string, unknown>).entries
      : null;
  const entries = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : [];
  return entries
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object'),
    )
    .map((entry) => ({
      content: String(entry.content ?? ''),
      priority: entry.priority === 'high' || entry.priority === 'low' ? entry.priority : 'medium',
      status:
        entry.status === 'completed' || entry.status === 'in_progress' ? entry.status : 'pending',
    }));
}

function upsertPlan(session: WorkSession, update: Record<string, unknown>): WorkSession {
  const entries = normalizePlanEntries(update);
  if (entries.length === 0) return session;
  const index = session.timeline.findLastIndex((item) => item.type === 'plan');
  const timeline = [...session.timeline];
  if (index >= 0) {
    const current = timeline[index];
    if (current?.type === 'plan') timeline[index] = { ...current, entries };
  } else {
    timeline.push({ id: nowId('plan'), type: 'plan', entries, createdAt: Date.now() });
  }
  return { ...session, timeline, updatedAt: Date.now() };
}

function finishTurn(session: WorkSession, stopReason: string, usage: unknown): WorkSession {
  const status = stopReason === 'cancelled' ? 'cancelled' : 'completed';
  const timeline = session.timeline.map((item) => {
    if (item.type === 'message' && item.role === 'assistant' && item.streaming) {
      return { ...item, streaming: false };
    }
    if (item.type === 'thought' && item.streaming) return { ...item, streaming: false };
    return item;
  });
  timeline.push({
    id: nowId('done'),
    type: 'status',
    label: stopReason === 'cancelled' ? '任务已停止' : '本轮任务完成',
    tone: stopReason === 'cancelled' ? 'warning' : 'success',
    createdAt: Date.now(),
  });
  return { ...session, timeline, status, usage, updatedAt: Date.now() };
}

function applyAcpUpdate(session: WorkSession, update: Record<string, unknown>): WorkSession {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return appendAgentChunk(session, textFromContent(update.content));
    case 'agent_thought_chunk':
      return appendThoughtChunk(session, textFromContent(update.content));
    case 'tool_call':
    case 'tool_call_update':
      return upsertTool(session, update);
    case 'plan':
    case 'plan_update':
      return upsertPlan(session, update);
    case 'plan_removed':
      return { ...session, timeline: session.timeline.filter((item) => item.type !== 'plan') };
    case 'current_mode_update':
      return {
        ...session,
        currentModeId: String(update.currentModeId ?? update.modeId ?? session.currentModeId),
      };
    case 'session_info_update': {
      const title = typeof update.title === 'string' ? update.title : session.title;
      return { ...session, title };
    }
    case 'usage_update':
      return { ...session, usage: update };
    case 'client_turn_complete':
      return finishTurn(session, String(update.stopReason ?? 'end_turn'), update.usage);
    case 'client_turn_error': {
      const timeline: TimelineItem[] = [
        ...session.timeline,
        {
          id: nowId('error'),
          type: 'message',
          role: 'system',
          content: String(update.detail ?? 'Grok 执行失败。'),
          error: true,
          createdAt: Date.now(),
        },
      ];
      return { ...session, timeline, status: 'failed', updatedAt: Date.now() };
    }
    default:
      return session;
  }
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'PROJECT_ADDED': {
      const existing = state.projects.find((project) => project.path === action.project.path);
      if (existing) {
        return {
          ...state,
          projects: state.projects.map((project) =>
            project.id === existing.id ? { ...action.project, id: existing.id } : project,
          ),
          activeProjectId: existing.id,
          activeSessionId:
            state.sessions.find((session) => session.projectId === existing.id)?.id ?? null,
        };
      }
      return {
        ...state,
        projects: [...state.projects, action.project],
        activeProjectId: action.project.id,
        activeSessionId: null,
      };
    }
    case 'PROJECT_UPDATED':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.project.id ? action.project : project,
        ),
      };
    case 'PROJECT_SELECTED':
      return {
        ...state,
        activeProjectId: action.projectId,
        activeSessionId:
          state.sessions.find((session) => session.projectId === action.projectId)?.id ?? null,
      };
    case 'SESSION_CREATED':
      return {
        ...state,
        sessions: [action.session, ...state.sessions],
        activeSessionId: action.session.id,
        activeProjectId: action.session.projectId,
      };
    case 'SESSION_SELECTED': {
      const session = state.sessions.find((item) => item.id === action.sessionId);
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeProjectId: session?.projectId ?? state.activeProjectId,
      };
    }
    case 'SESSION_CONNECTED':
      return updateSession(state, action.localSessionId, (session) => ({
        ...session,
        acpSessionId: action.acpSessionId,
        currentModeId: action.currentModeId ?? session.currentModeId,
        availableModes: action.availableModes,
        status: 'idle',
      }));
    case 'SESSION_STATUS':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        status: action.status,
        updatedAt: Date.now(),
      }));
    case 'SESSION_TITLE':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        title: action.title,
        updatedAt: Date.now(),
      }));
    case 'USER_MESSAGE':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        title: session.title === '新任务' ? action.text.slice(0, 28) : session.title,
        status: 'working',
        updatedAt: Date.now(),
        timeline: [
          ...session.timeline,
          {
            id: nowId('user'),
            type: 'message',
            role: 'user',
            content: action.text,
            createdAt: Date.now(),
          },
        ],
      }));
    case 'ACP_UPDATE':
      return updateSession(state, action.sessionId, (session) =>
        applyAcpUpdate(session, action.update),
      );
    case 'CONNECTION':
      return {
        ...state,
        connectionStatus: action.status,
        connectionDetail: action.detail ?? state.connectionDetail,
      };
    case 'PERMISSION_REQUEST': {
      const target = state.sessions.find(
        (session) => session.acpSessionId === action.request.sessionId,
      );
      const next = target
        ? updateSession(state, target.id, (session) => ({
            ...session,
            status: 'awaiting_permission',
          }))
        : state;
      return { ...next, pendingPermission: action.request };
    }
    case 'PERMISSION_CLEARED': {
      if (state.pendingPermission?.requestId !== action.requestId) return state;
      const target = state.sessions.find(
        (session) => session.acpSessionId === state.pendingPermission?.sessionId,
      );
      const next = target
        ? updateSession(state, target.id, (session) => ({ ...session, status: 'working' }))
        : state;
      return { ...next, pendingPermission: null };
    }
    case 'SIDEBAR_TOGGLED':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'INSPECTOR_TOGGLED':
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case 'INSPECTOR_TAB':
      return { ...state, inspectorTab: action.tab, inspectorOpen: true };
    case 'COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: action.open };
    case 'SETTINGS':
      return { ...state, settingsOpen: action.open };
    case 'APP_VERSION':
      return { ...state, appVersion: action.version };
    default:
      return state;
  }
}

export function loadState(fallback: AppState): AppState {
  try {
    const raw = localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<AppState>;
    return {
      ...fallback,
      projects: Array.isArray(saved.projects) ? saved.projects : fallback.projects,
      sessions: Array.isArray(saved.sessions) ? saved.sessions : fallback.sessions,
      activeProjectId: saved.activeProjectId ?? fallback.activeProjectId,
      activeSessionId: saved.activeSessionId ?? fallback.activeSessionId,
      sidebarCollapsed: saved.sidebarCollapsed ?? fallback.sidebarCollapsed,
      inspectorOpen: saved.inspectorOpen ?? fallback.inspectorOpen,
      inspectorTab: saved.inspectorTab ?? fallback.inspectorTab,
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  const persisted = {
    projects: state.projects,
    sessions: state.sessions.map((session) => ({
      ...session,
      status:
        session.status === 'working' || session.status === 'connecting' ? 'idle' : session.status,
    })),
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sidebarCollapsed: state.sidebarCollapsed,
    inspectorOpen: state.inspectorOpen,
    inspectorTab: state.inspectorTab,
  };
  localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(persisted));
}

export const reducerTestHelpers = {
  applyAcpUpdate,
};
