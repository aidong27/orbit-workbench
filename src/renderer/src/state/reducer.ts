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
  WorkspaceProject,
} from './model';
import { workspacePathKey } from './model';
import { reconcilePlanEntries } from './plan';

const MAX_IN_MEMORY_TIMELINE_ITEMS = 600;

function reconcileProjectState(
  projects: WorkspaceProject[],
  sessions: WorkSession[],
): {
  projects: WorkspaceProject[];
  sessions: WorkSession[];
  resolveProjectId: (projectId: string | null) => string | null;
} {
  const parent = projects.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[index] !== index) {
      const next = parent[index] ?? root;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const indexById = new Map<string, number>();
  const indexByPath = new Map<string, number>();

  projects.forEach((project, index) => {
    const sameId = indexById.get(project.id);
    if (sameId === undefined) indexById.set(project.id, index);
    else union(index, sameId);

    const pathKey = workspacePathKey(project.path);
    if (!pathKey) return;
    const samePath = indexByPath.get(pathKey);
    if (samePath === undefined) indexByPath.set(pathKey, index);
    else union(index, samePath);
  });

  const indexesByRoot = new Map<number, number[]>();
  projects.forEach((_, index) => {
    const root = find(index);
    const indexes = indexesByRoot.get(root) ?? [];
    indexes.push(index);
    indexesByRoot.set(root, indexes);
  });

  const projectIdMap = new Map<string, string>();
  const reconciledProjects = [...indexesByRoot.values()]
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0))
    .map((indexes) => {
      const canonical = projects[indexes[0] ?? 0];
      const latest = projects[indexes.at(-1) ?? 0];
      if (!canonical || !latest) throw new Error('Project reconciliation received an empty group.');
      for (const index of indexes) {
        const project = projects[index];
        if (project) projectIdMap.set(project.id, canonical.id);
      }
      return {
        ...canonical,
        ...latest,
        id: canonical.id,
        addedAt: Math.min(...indexes.map((index) => projects[index]?.addedAt ?? latest.addedAt)),
        demo: latest.demo,
      };
    });
  const resolveProjectId = (projectId: string | null): string | null =>
    projectId === null ? null : (projectIdMap.get(projectId) ?? null);
  const reconciledSessions = sessions.map((session) => {
    const projectId = resolveProjectId(session.projectId);
    return projectId && projectId !== session.projectId ? { ...session, projectId } : session;
  });

  return {
    projects: reconciledProjects,
    sessions: reconciledSessions,
    resolveProjectId,
  };
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function mostRecentSessionId(sessions: WorkSession[], projectId: string | null): string | null {
  if (!projectId) return null;
  return (
    sessions
      .filter((session) => session.projectId === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id ?? null
  );
}

function retainKnownDrafts(
  drafts: AppState['draftsBySessionId'],
  sessions: WorkSession[],
): AppState['draftsBySessionId'] {
  const sessionIds = new Set(sessions.map((session) => session.id));
  return Object.fromEntries(
    Object.entries(drafts).filter(([sessionId, value]) => sessionIds.has(sessionId) && value),
  );
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

function applyConnectionEvent(
  state: AppState,
  event: {
    status: AppState['connectionStatus'];
    detail?: string;
    agentName?: string;
    agentVersion?: string;
    authenticated?: boolean | null;
    authMethod?: string | null;
    logoutSupported?: boolean;
    issueCode?: AppState['connectionIssueCode'];
    retryable?: boolean;
  },
): AppState {
  const disconnected = event.status === 'offline' || event.status === 'error';
  return {
    ...state,
    connectionStatus: event.status,
    connectionDetail: event.detail ?? state.connectionDetail,
    connectionIssueCode:
      event.status === 'ready' || event.status === 'checking' || event.status === 'connecting'
        ? null
        : (event.issueCode ?? state.connectionIssueCode),
    connectionRetryable:
      event.status === 'ready'
        ? false
        : (event.retryable ?? (disconnected ? true : state.connectionRetryable)),
    grokAuthenticated:
      event.authenticated === undefined
        ? disconnected
          ? null
          : state.grokAuthenticated
        : event.authenticated,
    grokAuthMethod:
      event.authMethod === undefined
        ? disconnected
          ? null
          : state.grokAuthMethod
        : event.authMethod,
    grokLogoutSupported:
      event.logoutSupported === undefined
        ? disconnected
          ? false
          : state.grokLogoutSupported
        : event.logoutSupported,
    grokAgentName: disconnected ? null : (event.agentName ?? state.grokAgentName),
    grokAgentVersion: disconnected ? null : (event.agentVersion ?? state.grokAgentVersion),
    sessions: disconnected
      ? state.sessions.map((session) => {
          if (session.demo) return session;
          const wasActive =
            session.status === 'working' ||
            session.status === 'connecting' ||
            session.status === 'awaiting_permission' ||
            session.status === 'cancelling';
          const timeline = wasActive
            ? finishStreamingItems(session.timeline, 'failed')
            : session.timeline;
          return {
            ...session,
            timeline,
            acpSessionId: null,
            continuity: timeline.length > 0 ? 'local-history-only' : 'fresh',
            confirmedModeId: null,
            availableModes: [],
            availableCommands: [],
            availableCommandsTruncated: false,
            configOptions: [],
            configOptionsTruncated: false,
            modeSwitchStatus: 'idle',
            modeSwitchError: null,
            modeRequestId: 0,
            status: wasActive ? ('failed' as const) : session.status,
            updatedAt: wasActive ? Date.now() : session.updatedAt,
          };
        })
      : state.sessions,
    pendingPermissions: disconnected ? [] : state.pendingPermissions,
  };
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
      const realProjects = state.projects.filter((project) => !project.demo);
      const realSessions = state.sessions.filter((session) => !session.demo);
      const reconciled = reconcileProjectState([...realProjects, action.project], realSessions);
      const activeProjectId = reconciled.resolveProjectId(action.project.id);
      return {
        ...state,
        projects: reconciled.projects,
        sessions: reconciled.sessions,
        draftsBySessionId: retainKnownDrafts(state.draftsBySessionId, reconciled.sessions),
        activeProjectId,
        activeSessionId: mostRecentSessionId(reconciled.sessions, activeProjectId),
      };
    }
    case 'PROJECT_UPDATED': {
      const projects = state.projects.some((project) => project.id === action.project.id)
        ? [...state.projects, action.project]
        : state.projects;
      const reconciled = reconcileProjectState(projects, state.sessions);
      return {
        ...state,
        projects: reconciled.projects,
        sessions: reconciled.sessions,
        draftsBySessionId: retainKnownDrafts(state.draftsBySessionId, reconciled.sessions),
        activeProjectId: reconciled.resolveProjectId(state.activeProjectId),
      };
    }
    case 'PROJECT_SELECTED': {
      const reconciled = reconcileProjectState(state.projects, state.sessions);
      const activeProjectId =
        reconciled.resolveProjectId(action.projectId) ??
        reconciled.resolveProjectId(state.activeProjectId);
      return {
        ...state,
        projects: reconciled.projects,
        sessions: reconciled.sessions,
        draftsBySessionId: retainKnownDrafts(state.draftsBySessionId, reconciled.sessions),
        activeProjectId,
        activeSessionId: mostRecentSessionId(reconciled.sessions, activeProjectId),
      };
    }
    case 'SESSION_CREATED': {
      const draftsBySessionId = Object.fromEntries(
        Object.entries(state.draftsBySessionId).filter(
          ([sessionId]) => sessionId !== action.sourceDraftSessionId,
        ),
      );
      if (action.draft) draftsBySessionId[action.session.id] = action.draft;
      return {
        ...state,
        sessions: [action.session, ...state.sessions.filter((session) => !session.demo)],
        activeSessionId: action.session.id,
        activeProjectId: action.session.projectId,
        draftsBySessionId,
      };
    }
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
    case 'USER_MESSAGE': {
      const targetSession = state.sessions.find((session) => session.id === action.sessionId);
      if (!targetSession || targetSession.continuity === 'local-history-only') return state;
      return {
        ...updateSession(state, action.sessionId, (session) => {
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
        }),
        draftsBySessionId: Object.fromEntries(
          Object.entries(state.draftsBySessionId).filter(
            ([sessionId]) => sessionId !== action.sessionId,
          ),
        ),
      };
    }
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
          : session.confirmedModeId === action.modeId
            ? {
                ...session,
                requestedModeId: action.modeId,
                modeSwitchStatus: 'idle',
                modeSwitchError: null,
              }
            : {
                ...session,
                requestedModeId: session.confirmedModeId,
                modeSwitchStatus: 'failed',
                modeSwitchError: action.error,
                updatedAt: Date.now(),
              },
      );
    case 'CONNECTION_ATTEMPT':
      return {
        ...state,
        connectionAttemptId: action.attemptId,
        connectionStatus: 'checking',
        connectionDetail: '正在检测本机 Grok Build…',
        connectionIssueCode: null,
        connectionRetryable: false,
      };
    case 'GROK_INSPECTED':
      if (action.attemptId !== state.connectionAttemptId) return state;
      return {
        ...state,
        connectionStatus: action.result.status,
        connectionDetail:
          action.result.detail ??
          (action.result.status === 'detected'
            ? '已检测到 Grok Build，正在建立 ACP 连接…'
            : state.connectionDetail),
        connectionIssueCode: action.result.issueCode ?? null,
        connectionRetryable: action.result.retryable ?? action.result.status !== 'detected',
        grokBinaryPath: action.result.binaryPath,
        grokCliVersion: action.result.version,
        grokAuthenticated: action.result.authenticated,
      };
    case 'CONNECTION_RESULT':
      if (action.attemptId !== state.connectionAttemptId) return state;
      return applyConnectionEvent(state, action.result);
    case 'CONNECTION_EVENT':
      return applyConnectionEvent(state, action.event);
    case 'GROK_LOGGED_OUT': {
      const disconnected = applyConnectionEvent(state, {
        status: action.confirmed ? 'offline' : 'error',
        detail: action.detail,
        issueCode: action.confirmed ? 'authentication_required' : 'authentication_failed',
        retryable: true,
        authenticated: action.confirmed ? false : null,
        authMethod: null,
        logoutSupported: false,
      });
      return {
        ...disconnected,
        autoConnectGrok: false,
        grokAgentName: null,
        grokAgentVersion: null,
      };
    }
    case 'AUTO_CONNECT_GROK':
      return { ...state, autoConnectGrok: action.enabled };
    case 'DRAFT_CHANGED': {
      if (!state.sessions.some((session) => session.id === action.sessionId)) return state;
      if (!action.value) {
        return {
          ...state,
          draftsBySessionId: Object.fromEntries(
            Object.entries(state.draftsBySessionId).filter(
              ([sessionId]) => sessionId !== action.sessionId,
            ),
          ),
        };
      }
      return {
        ...state,
        draftsBySessionId: {
          ...state.draftsBySessionId,
          [action.sessionId]: action.value,
        },
      };
    }
    case 'DRAFT_CLEARED':
      return {
        ...state,
        draftsBySessionId: Object.fromEntries(
          Object.entries(state.draftsBySessionId).filter(
            ([sessionId]) => sessionId !== action.sessionId,
          ),
        ),
      };
    case 'UI_TEXT_SCALE':
      return { ...state, uiTextScale: action.scale };
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
      return {
        ...state,
        commandPaletteOpen: action.open,
        settingsOpen: action.open ? false : state.settingsOpen,
      };
    case 'SETTINGS':
      return {
        ...state,
        settingsOpen: action.open,
        commandPaletteOpen: action.open ? false : state.commandPaletteOpen,
      };
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
