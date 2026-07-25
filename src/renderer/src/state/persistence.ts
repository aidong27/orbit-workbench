import { z } from 'zod';
import type { AppState, TimelineItem, WorkSession, WorkspaceProject } from './model';
import { reconcilePlanEntries } from './plan';

const PERSISTED_STATE_KEY = 'orbit-workbench-state-v3';
const V2_STATE_KEY = 'orbit-workbench-state-v2';
const LEGACY_STATE_KEY = 'orbit-workbench-state-v1';
const MAX_PERSISTED_SESSIONS = 40;
const MAX_PERSISTED_TIMELINE_ITEMS = 160;
const MAX_PERSISTED_SESSION_CHARACTERS = 1_000_000;
const MAX_MESSAGE_CHARACTERS = 200_000;
const MAX_THOUGHT_CHARACTERS = 80_000;

const projectSchema = z.object({
  id: z.string().min(1).max(256),
  path: z.string().max(32_768),
  name: z.string().min(1).max(1_024),
  branch: z.string().max(4_096).nullable(),
  isGitRepository: z.boolean(),
  changedFiles: z.number().int().nonnegative(),
  statusLines: z.array(z.string().max(32_768)).max(20_000),
  diffStat: z.string().max(500_000),
  addedAt: z.number().finite(),
  demo: z.boolean().optional(),
});

const messageSchema = z.object({
  id: z.string().min(1).max(512),
  type: z.literal('message'),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(MAX_MESSAGE_CHARACTERS),
  protocolMessageId: z.string().max(1_024).nullable().optional(),
  createdAt: z.number().finite(),
  streaming: z.boolean().optional(),
  error: z.boolean().optional(),
});

const thoughtSchema = z.object({
  id: z.string().min(1).max(512),
  type: z.literal('thought'),
  content: z.string().max(MAX_THOUGHT_CHARACTERS),
  protocolMessageId: z.string().max(1_024).nullable().optional(),
  createdAt: z.number().finite(),
  streaming: z.boolean().optional(),
});

const toolSchema = z.object({
  id: z.string().min(1).max(512),
  type: z.literal('tool'),
  toolCallId: z.string().min(1).max(1_024),
  title: z.string().max(2_048),
  kind: z.enum([
    'read',
    'edit',
    'delete',
    'move',
    'search',
    'execute',
    'think',
    'fetch',
    'switch_mode',
    'other',
  ]),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'unknown']),
  createdAt: z.number().finite(),
});

const planEntrySchema = z.object({
  id: z.string().max(512).optional(),
  content: z.string().max(50_000),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed']),
});

const planSchema = z.object({
  id: z.string().min(1).max(512),
  type: z.literal('plan'),
  planId: z.string().max(1_024).nullable().optional(),
  truncated: z.boolean().optional(),
  format: z.enum(['items', 'markdown', 'file']).optional(),
  entries: z.array(planEntrySchema).max(1_000).optional(),
  markdown: z.string().max(MAX_MESSAGE_CHARACTERS).optional(),
  uri: z.string().max(32_768).optional(),
  createdAt: z.number().finite(),
});

const statusSchema = z.object({
  id: z.string().min(1).max(512),
  type: z.literal('status'),
  label: z.string().max(10_000),
  tone: z.enum(['neutral', 'success', 'warning', 'error']),
  createdAt: z.number().finite(),
});

const timelineItemSchema = z.union([
  messageSchema,
  thoughtSchema,
  toolSchema,
  planSchema,
  statusSchema,
]);

const sessionSchema = z.object({
  id: z.string().min(1).max(256),
  projectId: z.string().min(1).max(256),
  title: z.string().min(1).max(4_096),
  status: z.enum([
    'idle',
    'connecting',
    'working',
    'awaiting_permission',
    'cancelling',
    'completed',
    'cancelled',
    'failed',
  ]),
  timeline: z.array(z.unknown()).max(MAX_PERSISTED_TIMELINE_ITEMS),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  requestedModeId: z.string().max(256).nullable().optional(),
  currentModeId: z.string().max(256).nullable().optional(),
  demo: z.boolean().optional(),
});

const persistedDataSchema = z.object({
  projects: z.array(z.unknown()).max(1_000),
  sessions: z.array(z.unknown()).max(MAX_PERSISTED_SESSIONS),
  activeProjectId: z.string().max(256).nullable().optional(),
  activeSessionId: z.string().max(256).nullable().optional(),
  sidebarCollapsed: z.boolean().optional(),
  inspectorOpen: z.boolean().optional(),
  inspectorTab: z.enum(['changes', 'plan', 'tools', 'context']).optional(),
});

const persistedEnvelopeV3Schema = z.object({
  schemaVersion: z.literal(3),
  savedAt: z.number().finite(),
  data: persistedDataSchema,
});

const persistedEnvelopeV2Schema = z.object({
  schemaVersion: z.literal(2),
  savedAt: z.number().finite(),
  data: persistedDataSchema,
});

function parseTimelineItem(value: unknown): TimelineItem | null {
  const parsed = timelineItemSchema.safeParse(value);
  if (!parsed.success) return null;
  const item = parsed.data;
  if (item.type === 'message') return { ...item, streaming: false };
  if (item.type === 'thought') return { ...item, streaming: false };
  if (item.type === 'tool') {
    return {
      ...item,
      status:
        item.status === 'pending' || item.status === 'in_progress' ? 'cancelled' : item.status,
    };
  }
  if (item.type !== 'plan') return item;

  const planId = item.planId ?? null;
  if (item.format === 'markdown' && item.markdown !== undefined) {
    return {
      id: item.id,
      type: 'plan',
      planId,
      format: 'markdown',
      markdown: item.markdown,
      truncated: item.truncated ?? false,
      createdAt: item.createdAt,
    };
  }
  if (item.format === 'file' && item.uri !== undefined) {
    return {
      id: item.id,
      type: 'plan',
      planId,
      format: 'file',
      uri: item.uri,
      truncated: item.truncated ?? false,
      createdAt: item.createdAt,
    };
  }
  const entries = item.entries ?? [];
  return {
    id: item.id,
    type: 'plan',
    planId,
    format: 'items',
    entries: reconcilePlanEntries(planId, entries),
    truncated: item.truncated ?? false,
    createdAt: item.createdAt,
  };
}

function parseProject(value: unknown): WorkspaceProject | null {
  const parsed = projectSchema.safeParse(value);
  return parsed.success && !parsed.data.demo ? parsed.data : null;
}

function parseSession(value: unknown, projectIds: ReadonlySet<string>): WorkSession | null {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success || parsed.data.demo || !projectIds.has(parsed.data.projectId)) return null;
  const timeline = parsed.data.timeline
    .map(parseTimelineItem)
    .filter((item): item is TimelineItem => item !== null);
  return {
    id: parsed.data.id,
    projectId: parsed.data.projectId,
    title: parsed.data.title,
    acpSessionId: null,
    status:
      parsed.data.status === 'completed' ||
      parsed.data.status === 'cancelled' ||
      parsed.data.status === 'failed'
        ? parsed.data.status
        : 'idle',
    timeline,
    createdAt: parsed.data.createdAt,
    updatedAt: parsed.data.updatedAt,
    continuity: timeline.length > 0 ? 'local-history-only' : 'fresh',
    confirmedModeId: null,
    requestedModeId: parsed.data.requestedModeId ?? parsed.data.currentModeId ?? null,
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

function normalizePersistedState(fallback: AppState, value: unknown): AppState | null {
  const parsed = persistedDataSchema.safeParse(value);
  if (!parsed.success) return null;
  const projects = parsed.data.projects
    .map(parseProject)
    .filter((project): project is WorkspaceProject => project !== null);
  const projectIds = new Set(projects.map((project) => project.id));
  const sessions = parsed.data.sessions
    .map((session) => parseSession(session, projectIds))
    .filter((session): session is WorkSession => session !== null);
  const requestedProjectId = parsed.data.activeProjectId;
  const activeProjectId =
    requestedProjectId && projectIds.has(requestedProjectId)
      ? requestedProjectId
      : (projects[0]?.id ?? null);
  const requestedSession = sessions.find((session) => session.id === parsed.data.activeSessionId);
  const activeSessionId =
    requestedSession?.projectId === activeProjectId
      ? requestedSession.id
      : (sessions.find((session) => session.projectId === activeProjectId)?.id ?? null);

  return {
    ...fallback,
    projects,
    sessions,
    activeProjectId,
    activeSessionId,
    sidebarCollapsed: parsed.data.sidebarCollapsed ?? fallback.sidebarCollapsed,
    inspectorOpen: parsed.data.inspectorOpen ?? fallback.inspectorOpen,
    inspectorTab: parsed.data.inspectorTab ?? fallback.inspectorTab,
    pendingPermissions: [],
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function rehydrateState(fallback: AppState, saved: unknown): AppState {
  return normalizePersistedState(fallback, saved) ?? fallback;
}

export function loadState(fallback: AppState): AppState {
  try {
    const currentRaw = localStorage.getItem(PERSISTED_STATE_KEY);
    if (currentRaw) {
      const envelope = persistedEnvelopeV3Schema.safeParse(parseJson(currentRaw));
      if (envelope.success) return rehydrateState(fallback, envelope.data.data);
      return fallback;
    }

    const v2Raw = localStorage.getItem(V2_STATE_KEY);
    if (v2Raw) {
      const envelope = persistedEnvelopeV2Schema.safeParse(parseJson(v2Raw));
      if (!envelope.success) return fallback;
      const migrated = normalizePersistedState(fallback, envelope.data.data);
      if (!migrated) return fallback;
      saveState(migrated);
      return migrated;
    }

    const legacyRaw = localStorage.getItem(LEGACY_STATE_KEY);
    if (!legacyRaw) return fallback;
    const migrated = normalizePersistedState(fallback, parseJson(legacyRaw));
    if (!migrated) return fallback;
    saveState(migrated);
    return migrated;
  } catch {
    return fallback;
  }
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const suffix = '\n…持久化内容已截断';
  return `${value.slice(0, Math.max(0, maximum - suffix.length))}${suffix}`;
}

function sanitizeTimelineItem(item: TimelineItem): TimelineItem {
  if (item.type === 'message') {
    return { ...item, content: truncate(item.content, MAX_MESSAGE_CHARACTERS), streaming: false };
  }
  if (item.type === 'thought') {
    return { ...item, content: truncate(item.content, MAX_THOUGHT_CHARACTERS), streaming: false };
  }
  if (item.type === 'tool') {
    return {
      id: item.id,
      type: 'tool',
      toolCallId: item.toolCallId,
      title: item.title,
      kind: item.kind,
      status:
        item.status === 'pending' || item.status === 'in_progress' ? 'cancelled' : item.status,
      createdAt: item.createdAt,
    };
  }
  if (item.type === 'plan' && item.format === 'markdown') {
    return { ...item, markdown: truncate(item.markdown, MAX_MESSAGE_CHARACTERS) };
  }
  return item;
}

function boundedTimeline(timeline: TimelineItem[]): TimelineItem[] {
  const selected: TimelineItem[] = [];
  let characters = 0;
  for (const item of timeline.slice(-MAX_PERSISTED_TIMELINE_ITEMS).reverse()) {
    const sanitized = sanitizeTimelineItem(item);
    const size = JSON.stringify(sanitized).length;
    if (characters + size > MAX_PERSISTED_SESSION_CHARACTERS) break;
    characters += size;
    selected.push(sanitized);
  }
  return selected.reverse();
}

export function saveState(state: AppState): boolean {
  const projects = state.projects.filter((project) => !project.demo);
  const projectIds = new Set(projects.map((project) => project.id));
  const activeSession = state.sessions.find(
    (session) => session.id === state.activeSessionId && !session.demo,
  );
  const sessions = [
    ...(activeSession ? [activeSession] : []),
    ...state.sessions.filter((session) => session.id !== activeSession?.id && !session.demo),
  ]
    .filter((session) => projectIds.has(session.projectId))
    .slice(0, MAX_PERSISTED_SESSIONS)
    .map((session) => ({
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      status: session.status,
      timeline: boundedTimeline(session.timeline),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      requestedModeId: session.requestedModeId,
    }));
  const envelope = {
    schemaVersion: 3 as const,
    savedAt: Date.now(),
    data: {
      projects,
      sessions,
      activeProjectId:
        state.activeProjectId && projectIds.has(state.activeProjectId)
          ? state.activeProjectId
          : (projects[0]?.id ?? null),
      activeSessionId: sessions.some((session) => session.id === state.activeSessionId)
        ? state.activeSessionId
        : null,
      sidebarCollapsed: state.sidebarCollapsed,
      inspectorOpen: state.inspectorOpen,
      inspectorTab: state.inspectorTab,
    },
  };
  try {
    localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(envelope));
    localStorage.removeItem(V2_STATE_KEY);
    localStorage.removeItem(LEGACY_STATE_KEY);
    return true;
  } catch {
    // A full or disabled localStorage must never interrupt an active ACP stream.
    return false;
  }
}

export const persistenceTestHelpers = {
  PERSISTED_STATE_KEY,
  V2_STATE_KEY,
  LEGACY_STATE_KEY,
  normalizePersistedState,
};
