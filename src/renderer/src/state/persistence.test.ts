import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './demo';
import type { AppState, WorkSession, WorkspaceProject } from './model';
import { loadState, persistenceTestHelpers, rehydrateState, saveState } from './persistence';

afterEach(() => vi.unstubAllGlobals());

function project(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    id: 'project-1',
    path: '/tmp/project-1',
    name: 'project-1',
    branch: 'main',
    isGitRepository: true,
    changedFiles: 0,
    statusLines: [],
    diffStat: '',
    addedAt: 1,
    ...overrides,
  };
}

function session(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    title: '任务',
    acpSessionId: 'live-acp-id',
    status: 'completed',
    timeline: [],
    createdAt: 1,
    updatedAt: 2,
    continuity: 'live',
    confirmedModeId: 'plan',
    requestedModeId: 'plan',
    modeSwitchStatus: 'idle',
    modeSwitchError: null,
    modeRequestId: 0,
    availableModes: [{ id: 'plan', name: '计划' }],
    availableCommands: [],
    configOptions: [],
    ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    projects: [project()],
    sessions: [session()],
    activeProjectId: 'project-1',
    activeSessionId: 'session-1',
    connectionStatus: 'ready',
    connectionDetail: 'connected',
    connectionAttemptId: 0,
    connectionIssueCode: null,
    connectionRetryable: false,
    grokBinaryPath: null,
    grokCliVersion: null,
    grokAuthenticated: null,
    grokAgentName: null,
    grokAgentVersion: null,
    pendingPermissions: [],
    sidebarCollapsed: false,
    inspectorOpen: true,
    inspectorTab: 'changes',
    commandPaletteOpen: false,
    settingsOpen: false,
    appVersion: 'test',
    appPlatform: 'darwin',
    appArch: 'arm64',
    ...overrides,
  };
}

function localStorageMock(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

describe('versioned persistence', () => {
  it('starts from a real empty state instead of demo domain entities', () => {
    expect(initialState).toMatchObject({
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
    });
  });

  it('writes a v3 envelope without demo entities, ACP ids, or tool payloads', () => {
    const storage = localStorageMock();
    vi.stubGlobal('localStorage', storage);
    const sensitiveSession = session({
      timeline: [
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'tool-1',
          title: '读取私有文件',
          kind: 'read',
          status: 'completed',
          rawInput: { path: '/Users/alice/private.txt' },
          rawOutput: 'secret',
          locations: [{ path: '/Users/alice/private.txt' }],
          createdAt: 1,
        },
      ],
    });
    const demoProject = project({ id: 'demo-project', path: '', demo: true });
    const demoSession = session({ id: 'demo-session', projectId: 'demo-project', demo: true });

    saveState(
      state({
        projects: [demoProject, project()],
        sessions: [demoSession, sensitiveSession],
      }),
    );

    const raw = storage.values.get(persistenceTestHelpers.PERSISTED_STATE_KEY);
    expect(raw).toBeTruthy();
    const envelope = JSON.parse(String(raw)) as {
      schemaVersion: number;
      data: { projects: WorkspaceProject[]; sessions: WorkSession[] };
    };
    expect(envelope.schemaVersion).toBe(3);
    expect(envelope.data.projects.map((item) => item.id)).toEqual(['project-1']);
    expect(envelope.data.sessions.map((item) => item.id)).toEqual(['session-1']);
    expect(raw).not.toContain('live-acp-id');
    expect(raw).not.toContain('private.txt');
    expect(raw).not.toContain('secret');
    expect(storage.removeItem).toHaveBeenCalledWith(persistenceTestHelpers.V2_STATE_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(persistenceTestHelpers.LEGACY_STATE_KEY);
  });

  it('persists a legitimate empty state and removes stale v2/v1 records', () => {
    const storage = localStorageMock({
      [persistenceTestHelpers.V2_STATE_KEY]: 'stale-v2',
      [persistenceTestHelpers.LEGACY_STATE_KEY]: 'stale-v1',
    });
    vi.stubGlobal('localStorage', storage);
    saveState(
      state({
        projects: [project({ id: 'demo-project', path: '', demo: true })],
        sessions: [session({ id: 'demo-session', projectId: 'demo-project', demo: true })],
      }),
    );

    const raw = storage.values.get(persistenceTestHelpers.PERSISTED_STATE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(String(raw))).toMatchObject({
      schemaVersion: 3,
      data: {
        projects: [],
        sessions: [],
        activeProjectId: null,
        activeSessionId: null,
      },
    });
    expect(storage.values.has(persistenceTestHelpers.V2_STATE_KEY)).toBe(false);
    expect(storage.values.has(persistenceTestHelpers.LEGACY_STATE_KEY)).toBe(false);
  });

  it('round-trips an empty v3 state without reviving fallback projects', () => {
    const storage = localStorageMock();
    vi.stubGlobal('localStorage', storage);
    saveState(
      state({
        projects: [],
        sessions: [],
        activeProjectId: null,
        activeSessionId: null,
      }),
    );

    const restored = loadState(state());
    expect(restored).toMatchObject({
      projects: [],
      sessions: [],
      activeProjectId: null,
      activeSessionId: null,
    });
  });

  it('reports a storage failure without throwing into the active UI', () => {
    const storage = localStorageMock();
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.stubGlobal('localStorage', storage);

    expect(saveState(state())).toBe(false);
  });

  it('migrates legacy sessions into honest local-history-only records', () => {
    const restored = rehydrateState(state(), {
      projects: [project()],
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          title: '旧任务',
          status: 'working',
          timeline: [
            {
              id: 'message-1',
              type: 'message',
              role: 'user',
              content: '不要修改数据库',
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 2,
          currentModeId: 'plan',
        },
      ],
      activeProjectId: 'project-1',
      activeSessionId: 'session-1',
    });

    expect(restored.sessions[0]).toMatchObject({
      acpSessionId: null,
      continuity: 'local-history-only',
      confirmedModeId: null,
      requestedModeId: 'plan',
      status: 'idle',
    });
  });

  it('filters invalid records and repairs dangling active ids', () => {
    const restored = rehydrateState(state(), {
      projects: [project(), null, 42],
      sessions: [
        {
          id: 'dangling',
          projectId: 'missing-project',
          title: 'dangling',
          status: 'idle',
          timeline: [],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'valid',
          projectId: 'project-1',
          title: 'valid',
          status: 'idle',
          timeline: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeProjectId: 'missing-project',
      activeSessionId: 'dangling',
    });

    expect(restored.projects).toHaveLength(1);
    expect(restored.sessions.map((item) => item.id)).toEqual(['valid']);
    expect(restored.activeProjectId).toBe('project-1');
    expect(restored.activeSessionId).toBe('valid');
  });

  it('migrates a v2 envelope to v3 and only then removes old keys', () => {
    const storage = localStorageMock({
      [persistenceTestHelpers.V2_STATE_KEY]: JSON.stringify({
        schemaVersion: 2,
        savedAt: 2,
        data: {
          projects: [project()],
          sessions: [
            {
              id: 'session-1',
              projectId: 'project-1',
              title: 'v2 任务',
              status: 'working',
              timeline: [
                {
                  id: 'message-1',
                  type: 'message',
                  role: 'user',
                  content: '旧上下文',
                  createdAt: 1,
                },
              ],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          activeProjectId: 'project-1',
          activeSessionId: 'session-1',
        },
      }),
      [persistenceTestHelpers.LEGACY_STATE_KEY]: JSON.stringify({
        projects: [project({ name: '不应读取的 v1' })],
        sessions: [],
      }),
    });
    vi.stubGlobal('localStorage', storage);

    const restored = loadState(state({ projects: [], sessions: [] }));

    expect(restored.sessions[0]).toMatchObject({
      title: 'v2 任务',
      continuity: 'local-history-only',
      acpSessionId: null,
      status: 'idle',
    });
    expect(
      JSON.parse(String(storage.values.get(persistenceTestHelpers.PERSISTED_STATE_KEY))),
    ).toMatchObject({
      schemaVersion: 3,
      data: { projects: [{ id: 'project-1' }], sessions: [{ id: 'session-1' }] },
    });
    expect(storage.values.has(persistenceTestHelpers.V2_STATE_KEY)).toBe(false);
    expect(storage.values.has(persistenceTestHelpers.LEGACY_STATE_KEY)).toBe(false);
  });

  it('migrates raw v1 data when no newer record exists', () => {
    const storage = localStorageMock({
      [persistenceTestHelpers.LEGACY_STATE_KEY]: JSON.stringify({
        projects: [project()],
        sessions: [],
        activeProjectId: 'project-1',
        activeSessionId: null,
      }),
    });
    vi.stubGlobal('localStorage', storage);

    const restored = loadState(state({ projects: [], sessions: [] }));

    expect(restored.projects.map((item) => item.id)).toEqual(['project-1']);
    expect(
      JSON.parse(String(storage.values.get(persistenceTestHelpers.PERSISTED_STATE_KEY))),
    ).toMatchObject({
      schemaVersion: 3,
    });
    expect(storage.values.has(persistenceTestHelpers.LEGACY_STATE_KEY)).toBe(false);
  });

  it('keeps v2 intact when the v3 migration write fails', () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      savedAt: 2,
      data: {
        projects: [project()],
        sessions: [],
        activeProjectId: 'project-1',
        activeSessionId: null,
      },
    });
    const storage = localStorageMock({
      [persistenceTestHelpers.V2_STATE_KEY]: v2,
    });
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.stubGlobal('localStorage', storage);

    const restored = loadState(state({ projects: [], sessions: [] }));

    expect(restored.projects.map((item) => item.id)).toEqual(['project-1']);
    expect(storage.values.get(persistenceTestHelpers.V2_STATE_KEY)).toBe(v2);
    expect(storage.values.has(persistenceTestHelpers.PERSISTED_STATE_KEY)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps v1 intact when the v3 migration write fails', () => {
    const v1 = JSON.stringify({
      projects: [project()],
      sessions: [],
      activeProjectId: 'project-1',
      activeSessionId: null,
    });
    const storage = localStorageMock({
      [persistenceTestHelpers.LEGACY_STATE_KEY]: v1,
    });
    storage.setItem.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.stubGlobal('localStorage', storage);

    const restored = loadState(state({ projects: [], sessions: [] }));

    expect(restored.projects.map((item) => item.id)).toEqual(['project-1']);
    expect(storage.values.get(persistenceTestHelpers.LEGACY_STATE_KEY)).toBe(v1);
    expect(storage.values.has(persistenceTestHelpers.PERSISTED_STATE_KEY)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('falls back safely for corrupt JSON and unknown schema versions', () => {
    const fallback = state();
    const corrupt = localStorageMock({
      [persistenceTestHelpers.PERSISTED_STATE_KEY]: '{broken',
      [persistenceTestHelpers.LEGACY_STATE_KEY]: '{also broken',
    });
    vi.stubGlobal('localStorage', corrupt);
    expect(loadState(fallback)).toBe(fallback);

    const unknown = localStorageMock({
      [persistenceTestHelpers.PERSISTED_STATE_KEY]: JSON.stringify({
        schemaVersion: 99,
        savedAt: Date.now(),
        data: {},
      }),
    });
    vi.stubGlobal('localStorage', unknown);
    expect(loadState(fallback)).toBe(fallback);
  });

  it('never revives older private history when a v3 record exists but is invalid', () => {
    const fallback = state();
    const storage = localStorageMock({
      [persistenceTestHelpers.PERSISTED_STATE_KEY]: '{broken',
      [persistenceTestHelpers.V2_STATE_KEY]: JSON.stringify({
        schemaVersion: 2,
        savedAt: 2,
        data: {
          projects: [project()],
          sessions: [session({ title: '不应复活的 v2 聊天' })],
        },
      }),
      [persistenceTestHelpers.LEGACY_STATE_KEY]: JSON.stringify({
        projects: [project()],
        sessions: [session({ title: '不应复活的旧聊天' })],
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadState(fallback)).toBe(fallback);
  });

  it('never falls through to v1 when a v2 record exists but is invalid', () => {
    const fallback = state();
    const storage = localStorageMock({
      [persistenceTestHelpers.V2_STATE_KEY]: '{broken',
      [persistenceTestHelpers.LEGACY_STATE_KEY]: JSON.stringify({
        projects: [project()],
        sessions: [session({ title: '不应复活的旧聊天' })],
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadState(fallback)).toBe(fallback);
  });

  it('round-trips sanitized 1024-character protocol identifiers', () => {
    const identifier = 'p'.repeat(1_024);
    const restored = rehydrateState(state(), {
      projects: [project()],
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          title: '长标识测试',
          status: 'completed',
          timeline: [
            {
              id: 'message-1',
              type: 'message',
              role: 'assistant',
              content: 'ok',
              protocolMessageId: identifier,
              createdAt: 1,
            },
            {
              id: 'tool-1',
              type: 'tool',
              toolCallId: identifier,
              title: 'tool',
              kind: 'other',
              status: 'unknown',
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    expect(restored.sessions[0]?.timeline).toMatchObject([
      { protocolMessageId: identifier },
      { toolCallId: identifier, status: 'unknown' },
    ]);
  });

  it('round-trips oversized text at the schema boundary instead of dropping the item', () => {
    const storage = localStorageMock();
    vi.stubGlobal('localStorage', storage);
    saveState(
      state({
        sessions: [
          session({
            timeline: [
              {
                id: 'large-message',
                type: 'message',
                role: 'assistant',
                content: 'x'.repeat(210_000),
                createdAt: 1,
              },
            ],
          }),
        ],
      }),
    );

    const restored = loadState(state({ sessions: [] }));
    const item = restored.sessions[0]?.timeline[0];
    expect(item).toMatchObject({ id: 'large-message', type: 'message' });
    if (item?.type !== 'message') throw new Error('message was dropped');
    expect(item.content).toHaveLength(200_000);
    expect(item.content).toContain('持久化内容已截断');
  });
});
