import type { SanitizedToolCall, UiAcpEvent } from '../../../shared/types';
import type {
  AppAction,
  AppState,
  MessageItem,
  PlanItem,
  ThoughtItem,
  TimelineItem,
  ToolItem,
  WorkSession,
} from './model';
import { reconcilePlanEntries } from './plan';

const MAX_IN_MEMORY_TIMELINE_ITEMS = 600;

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
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const updated = updater(session);
      return updated.timeline.length > MAX_IN_MEMORY_TIMELINE_ITEMS
        ? { ...updated, timeline: updated.timeline.slice(-MAX_IN_MEMORY_TIMELINE_ITEMS) }
        : updated;
    }),
  };
}

function appendMessageChunk(
  session: WorkSession,
  role: 'user' | 'assistant',
  protocolMessageId: string | null,
  chunk: string,
): WorkSession {
  if (!chunk) return session;
  const timeline = [...session.timeline];
  const index =
    protocolMessageId === null
      ? timeline.length - 1
      : timeline.findLastIndex(
          (item) =>
            item.type === 'message' &&
            item.role === role &&
            item.protocolMessageId === protocolMessageId,
        );
  const candidate = index >= 0 ? timeline[index] : undefined;
  const canAppend =
    candidate?.type === 'message' &&
    candidate.role === role &&
    candidate.streaming === true &&
    (protocolMessageId !== null || candidate.protocolMessageId == null);

  if (canAppend) {
    timeline[index] = { ...candidate, content: `${candidate.content}${chunk}` };
  } else {
    const item: MessageItem = {
      id: nowId(role),
      type: 'message',
      role,
      content: chunk,
      protocolMessageId,
      streaming: true,
      createdAt: Date.now(),
    };
    timeline.push(item);
  }
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function appendThoughtChunk(
  session: WorkSession,
  protocolMessageId: string | null,
  chunk: string,
): WorkSession {
  if (!chunk) return session;
  const timeline = [...session.timeline];
  const index =
    protocolMessageId === null
      ? timeline.length - 1
      : timeline.findLastIndex(
          (item) => item.type === 'thought' && item.protocolMessageId === protocolMessageId,
        );
  const candidate = index >= 0 ? timeline[index] : undefined;
  const canAppend =
    candidate?.type === 'thought' &&
    candidate.streaming === true &&
    (protocolMessageId !== null || candidate.protocolMessageId == null);

  if (canAppend) {
    timeline[index] = { ...candidate, content: `${candidate.content}${chunk}` };
  } else {
    const item: ThoughtItem = {
      id: nowId('thought'),
      type: 'thought',
      content: chunk,
      protocolMessageId,
      streaming: true,
      createdAt: Date.now(),
    };
    timeline.push(item);
  }
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function upsertTool(session: WorkSession, update: SanitizedToolCall): WorkSession {
  const index = session.timeline.findIndex(
    (item) => item.type === 'tool' && item.toolCallId === update.toolCallId,
  );
  const current = index >= 0 ? (session.timeline[index] as ToolItem) : null;
  const next: ToolItem = {
    id: current?.id ?? nowId('tool'),
    type: 'tool',
    toolCallId: update.toolCallId,
    title:
      update.title === undefined ? (current?.title ?? '执行工具') : (update.title ?? '执行工具'),
    kind: update.kind === undefined ? (current?.kind ?? 'other') : (update.kind ?? 'other'),
    status:
      update.status === undefined
        ? (current?.status ?? 'in_progress')
        : (update.status ?? 'unknown'),
    content: update.content === undefined ? current?.content : update.content,
    rawInput: update.rawInput === undefined ? current?.rawInput : update.rawInput,
    rawOutput: update.rawOutput === undefined ? current?.rawOutput : update.rawOutput,
    locations: update.locations === undefined ? current?.locations : update.locations,
    createdAt: current?.createdAt ?? Date.now(),
  };
  const timeline = [...session.timeline];
  if (index >= 0) timeline[index] = next;
  else timeline.push(next);
  return { ...session, timeline, status: 'working', updatedAt: Date.now() };
}

function upsertPlan(session: WorkSession, plan: PlanItem): WorkSession {
  const index = session.timeline.findIndex(
    (item) => item.type === 'plan' && item.planId === plan.planId,
  );
  const timeline = [...session.timeline];
  if (index >= 0) {
    const current = timeline[index];
    timeline[index] = {
      ...plan,
      id: current?.id ?? plan.id,
      createdAt: current?.createdAt ?? plan.createdAt,
    };
  } else {
    timeline.push(plan);
  }
  return { ...session, timeline, updatedAt: Date.now() };
}

function finishStreamingItems(
  timeline: TimelineItem[],
  toolStatus?: 'failed' | 'cancelled',
): TimelineItem[] {
  return timeline.map((item) => {
    if (item.type === 'message' && item.streaming) return { ...item, streaming: false };
    if (item.type === 'thought' && item.streaming) return { ...item, streaming: false };
    if (
      item.type === 'tool' &&
      toolStatus &&
      (item.status === 'pending' || item.status === 'in_progress')
    ) {
      return { ...item, status: toolStatus };
    }
    return item;
  });
}

function finishTurn(
  session: WorkSession,
  stopReason: string,
  usage: WorkSession['lastTurnUsage'],
): WorkSession {
  const cancelled = stopReason === 'cancelled';
  const warning =
    stopReason === 'refusal' || stopReason === 'max_tokens' || stopReason === 'max_turn_requests';
  const timeline = finishStreamingItems(session.timeline, cancelled ? 'cancelled' : undefined);
  timeline.push({
    id: nowId('done'),
    type: 'status',
    label: cancelled ? '任务已停止' : warning ? `本轮已结束（${stopReason}）` : '本轮任务完成',
    tone: cancelled || warning ? 'warning' : 'success',
    createdAt: Date.now(),
  });
  return {
    ...session,
    timeline,
    status: cancelled ? 'cancelled' : 'completed',
    lastTurnUsage: usage,
    updatedAt: Date.now(),
  };
}

function failTurn(session: WorkSession, detail: string): WorkSession {
  const timeline = finishStreamingItems(session.timeline, 'failed');
  timeline.push({
    id: nowId('error'),
    type: 'message',
    role: 'system',
    content: detail,
    error: true,
    createdAt: Date.now(),
  });
  return { ...session, timeline, status: 'failed', updatedAt: Date.now() };
}

export function applyAcpEvent(session: WorkSession, event: UiAcpEvent): WorkSession {
  switch (event.type) {
    case 'message.chunk':
      return appendMessageChunk(session, event.role, event.messageId, event.text);
    case 'thought.chunk':
      return appendThoughtChunk(session, event.messageId, event.text);
    case 'tool.upsert':
      return upsertTool(session, event.toolCall);
    case 'plan.items': {
      const planId = event.planId;
      return upsertPlan(session, {
        id: nowId('plan'),
        type: 'plan',
        planId,
        format: 'items',
        entries: reconcilePlanEntries(planId, event.entries),
        truncated: event.truncated,
        createdAt: Date.now(),
      });
    }
    case 'plan.markdown':
      return upsertPlan(session, {
        id: nowId('plan'),
        type: 'plan',
        planId: event.planId,
        format: 'markdown',
        markdown: event.markdown,
        truncated: event.truncated,
        createdAt: Date.now(),
      });
    case 'plan.file':
      return upsertPlan(session, {
        id: nowId('plan'),
        type: 'plan',
        planId: event.planId,
        format: 'file',
        uri: event.uri,
        truncated: event.truncated,
        createdAt: Date.now(),
      });
    case 'plan.remove':
      return {
        ...session,
        timeline: session.timeline.filter(
          (item) => item.type !== 'plan' || item.planId !== event.planId,
        ),
        updatedAt: Date.now(),
      };
    case 'commands.replace':
      return {
        ...session,
        availableCommands: event.commands,
        availableCommandsTruncated: event.truncated,
        updatedAt: Date.now(),
      };
    case 'mode.confirmed': {
      const requestedWasConfirmed = session.requestedModeId === event.currentModeId;
      return {
        ...session,
        confirmedModeId: event.currentModeId,
        requestedModeId:
          session.modeSwitchStatus === 'switching' && !requestedWasConfirmed
            ? session.requestedModeId
            : event.currentModeId,
        modeSwitchStatus:
          session.modeSwitchStatus === 'switching' && !requestedWasConfirmed ? 'switching' : 'idle',
        modeSwitchError: requestedWasConfirmed ? null : session.modeSwitchError,
        updatedAt: Date.now(),
      };
    }
    case 'config.replace':
      return {
        ...session,
        configOptions: event.configOptions,
        configOptionsTruncated: event.truncated,
        updatedAt: Date.now(),
      };
    case 'session.info.patch': {
      const parsedUpdatedAt = event.updatedAt ? Date.parse(event.updatedAt) : Number.NaN;
      return {
        ...session,
        title: event.title === undefined ? session.title : (event.title ?? '未命名会话'),
        updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now(),
      };
    }
    case 'usage.replace':
      return { ...session, usage: event.usage, updatedAt: Date.now() };
    case 'turn.completed':
      return finishTurn(session, event.stopReason, event.usage);
    case 'turn.failed':
      return failTurn(session, event.detail);
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
      const realProjects = state.projects.filter((project) => !project.demo);
      const realSessions = state.sessions.filter((session) => !session.demo);
      return {
        ...state,
        projects: [...realProjects, action.project],
        sessions: realSessions,
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
        sessions: [action.session, ...state.sessions.filter((session) => !session.demo)],
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
        continuity: 'live',
        confirmedModeId: action.currentModeId,
        availableModes: action.availableModes,
        availableCommands: [],
        availableCommandsTruncated: false,
        configOptions: action.configOptions,
        configOptionsTruncated: action.configOptionsTruncated,
        modeSwitchStatus: 'idle',
        modeSwitchError: null,
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
      return updateSession(state, action.sessionId, (session) => {
        if (session.continuity === 'local-history-only') return session;
        return {
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
        };
      });
    case 'ACP_EVENT':
      return updateSession(state, action.sessionId, (session) =>
        applyAcpEvent(session, action.event),
      );
    case 'MODE_PREFERENCE_SET':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        requestedModeId: action.modeId,
        modeSwitchStatus: 'idle',
        modeSwitchError: null,
        modeRequestId: action.requestId,
      }));
    case 'MODE_SWITCH_REQUESTED':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        requestedModeId: action.modeId,
        modeSwitchStatus: 'switching',
        modeSwitchError: null,
        modeRequestId: action.requestId,
      }));
    case 'MODE_SWITCH_CONFIRMED':
      return updateSession(state, action.sessionId, (session) =>
        session.modeRequestId !== action.requestId
          ? session
          : {
              ...session,
              confirmedModeId: action.modeId,
              requestedModeId: action.modeId,
              modeSwitchStatus: 'idle',
              modeSwitchError: null,
              updatedAt: Date.now(),
            },
      );
    case 'MODE_SWITCH_FAILED':
      return updateSession(state, action.sessionId, (session) =>
        session.modeRequestId !== action.requestId
          ? session
          : {
              ...session,
              requestedModeId: session.confirmedModeId,
              modeSwitchStatus: 'failed',
              modeSwitchError: action.error,
              updatedAt: Date.now(),
            },
      );
    case 'CONNECTION': {
      const disconnected = action.status === 'offline' || action.status === 'error';
      return {
        ...state,
        connectionStatus: action.status,
        connectionDetail: action.detail ?? state.connectionDetail,
        sessions: disconnected
          ? state.sessions.map((session) => {
              if (session.demo) return session;
              const wasActive =
                session.status === 'working' ||
                session.status === 'connecting' ||
                session.status === 'awaiting_permission' ||
                session.status === 'cancelling';
              return {
                ...session,
                acpSessionId: null,
                continuity: session.timeline.length > 0 ? 'local-history-only' : 'fresh',
                confirmedModeId: null,
                availableModes: [],
                availableCommands: [],
                availableCommandsTruncated: false,
                configOptions: [],
                configOptionsTruncated: false,
                modeSwitchStatus: 'idle',
                modeSwitchError: null,
                status: wasActive ? ('failed' as const) : session.status,
              };
            })
          : state.sessions,
        pendingPermissions: disconnected ? [] : state.pendingPermissions,
      };
    }
    case 'PERMISSION_REQUEST': {
      if (
        state.pendingPermissions.some((request) => request.requestId === action.request.requestId)
      ) {
        return state;
      }
      const target = state.sessions.find(
        (session) => session.acpSessionId === action.request.sessionId,
      );
      if (!target) return state;
      const next = updateSession(state, target.id, (session) => ({
        ...session,
        status: 'awaiting_permission',
      }));
      return {
        ...next,
        commandPaletteOpen: false,
        settingsOpen: false,
        pendingPermissions: [...state.pendingPermissions, action.request],
      };
    }
    case 'PERMISSION_CLEARED': {
      const request = state.pendingPermissions.find((item) => item.requestId === action.requestId);
      if (!request) return state;
      const remaining = state.pendingPermissions.filter(
        (item) => item.requestId !== action.requestId,
      );
      const target = state.sessions.find((session) => session.acpSessionId === request.sessionId);
      const next = target
        ? updateSession(state, target.id, (session) =>
            session.status === 'awaiting_permission'
              ? {
                  ...session,
                  status: remaining.some((item) => item.sessionId === request.sessionId)
                    ? 'awaiting_permission'
                    : 'working',
                }
              : session,
          )
        : state;
      return { ...next, pendingPermissions: remaining };
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
    case 'APP_INFO':
      return {
        ...state,
        appVersion: action.version,
        appPlatform: action.platform,
        appArch: action.arch,
      };
    default:
      return state;
  }
}

export const reducerTestHelpers = {
  applyAcpEvent,
};
