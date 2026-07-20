import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState, WorkSession, WorkspaceProject } from './model';
import { makeProject, makeSession, sessionBlocksInput } from './model';
import { reducer, rehydrateState, saveState } from './reducer';

afterEach(() => vi.unstubAllGlobals());

function sessionFixture(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'local-session',
    projectId: 'project-1',
    title: '新任务',
    acpSessionId: 'acp-session',
    status: 'idle',
    timeline: [],
    createdAt: 1,
    updatedAt: 1,
    currentModeId: 'normal',
    availableModes: [],
    ...overrides,
  };
}

function stateFixture(session = sessionFixture()): AppState {
  return {
    projects: [],
    sessions: [session],
    activeProjectId: 'project-1',
    activeSessionId: session.id,
    connectionStatus: 'ready',
    connectionDetail: 'connected',
    pendingPermissions: [],
    sidebarCollapsed: false,
    inspectorOpen: true,
    inspectorTab: 'changes',
    commandPaletteOpen: false,
    settingsOpen: false,
    appVersion: 'test',
    appPlatform: 'darwin',
    appArch: 'arm64',
  };
}

describe('Grok ACP 状态归一化', () => {
  it('blocks a second prompt while a permission decision is pending', () => {
    expect(sessionBlocksInput('awaiting_permission')).toBe(true);
    expect(sessionBlocksInput('working')).toBe(true);
    expect(sessionBlocksInput('completed')).toBe(false);
  });

  it('reuses the stored project id when the same workspace is opened again', () => {
    const existing: WorkspaceProject = {
      id: 'stored-project',
      name: 'workspace',
      path: '/tmp/workspace',
      branch: 'main',
      isGitRepository: true,
      changedFiles: 0,
      statusLines: [],
      diffStat: '',
      addedAt: 1,
    };
    const state = {
      ...stateFixture(sessionFixture({ projectId: existing.id })),
      projects: [existing],
      activeProjectId: existing.id,
    };
    const reopened = makeProject(
      {
        name: 'workspace',
        path: '/tmp/workspace',
        branch: 'feature',
        isGitRepository: true,
        changedFiles: 1,
        statusLines: ['M src/app.tsx'],
        diffStat: '1 file changed',
      },
      state.projects,
    );
    const withProject = reducer(state, { type: 'PROJECT_ADDED', project: reopened });
    const next = reducer(withProject, {
      type: 'SESSION_CREATED',
      session: makeSession(reopened.id),
    });

    expect(reopened.id).toBe(existing.id);
    expect(next.projects).toHaveLength(1);
    expect(next.activeProjectId).toBe(existing.id);
    expect(next.sessions[0]?.projectId).toBe(existing.id);
  });

  it('drops stale ACP process state when restoring persisted sessions', () => {
    const fallback = stateFixture();
    const restored = rehydrateState(fallback, {
      sessions: [
        sessionFixture({
          acpSessionId: 'stale-process-session',
          status: 'awaiting_permission',
          availableModes: [{ id: 'plan', name: '计划' }],
        }),
      ],
    });

    expect(restored.sessions[0]).toMatchObject({
      acpSessionId: null,
      status: 'idle',
      availableModes: [],
    });
  });

  it('detaches live ACP sessions when the child process disconnects', () => {
    const disconnected = reducer(
      stateFixture(sessionFixture({ status: 'working', acpSessionId: 'live-session' })),
      { type: 'CONNECTION', status: 'error', detail: 'ACP exited' },
    );

    expect(disconnected.sessions[0]).toMatchObject({
      acpSessionId: null,
      status: 'failed',
      availableModes: [],
    });
    expect(disconnected.connectionDetail).toBe('ACP exited');
  });

  it('adds a user message and derives the initial title', () => {
    const next = reducer(stateFixture(), {
      type: 'USER_MESSAGE',
      sessionId: 'local-session',
      text: '请检查登录流程并补充测试',
    });

    expect(next.sessions[0]?.title).toBe('请检查登录流程并补充测试');
    expect(next.sessions[0]?.status).toBe('working');
    expect(next.sessions[0]?.timeline).toMatchObject([
      { type: 'message', role: 'user', content: '请检查登录流程并补充测试' },
    ]);
  });

  it('coalesces adjacent assistant streaming chunks', () => {
    const first = reducer(stateFixture(), {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '已经完成' },
      },
    });
    const second = reducer(first, {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '检查。' },
      },
    });

    expect(second.sessions[0]?.timeline).toHaveLength(1);
    expect(second.sessions[0]?.timeline[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: '已经完成检查。',
      streaming: true,
    });
  });

  it('updates a tool call in place without losing its title or input', () => {
    const created = reducer(stateFixture(), {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: '运行测试',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'pnpm test' },
      },
    });
    const completed = reducer(created, {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: '12 tests passed',
      },
    });

    expect(completed.sessions[0]?.timeline).toHaveLength(1);
    expect(completed.sessions[0]?.timeline[0]).toMatchObject({
      type: 'tool',
      title: '运行测试',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'pnpm test' },
      rawOutput: '12 tests passed',
    });
  });

  it('bounds large tool payloads and long in-memory timelines', () => {
    const withLargeTool = reducer(stateFixture(), {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'large-tool',
        rawOutput: 'x'.repeat(60_000),
      },
    });
    const tool = withLargeTool.sessions[0]?.timeline[0];
    expect(tool?.type).toBe('tool');
    if (tool?.type === 'tool') {
      expect(String(tool.rawOutput).length).toBeLessThan(51_000);
      expect(String(tool.rawOutput)).toContain('内容已截断');
    }

    let current = stateFixture();
    for (let index = 0; index < 620; index += 1) {
      current = reducer(current, {
        type: 'USER_MESSAGE',
        sessionId: 'local-session',
        text: `message-${index}`,
      });
    }
    expect(current.sessions[0]?.timeline).toHaveLength(600);
  });

  it('does not persist tool payloads or file locations', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    const state = stateFixture(
      sessionFixture({
        timeline: [
          {
            id: 'tool-sensitive',
            type: 'tool',
            toolCallId: 'tool-sensitive',
            title: '读取私有文件',
            kind: 'read',
            status: 'completed',
            content: 'private content',
            rawInput: { path: '/Users/alice/private.txt' },
            rawOutput: 'secret result',
            locations: [{ path: '/Users/alice/private.txt', line: 1 }],
            createdAt: 1,
          },
        ],
      }),
    );

    saveState(state);

    const raw = setItem.mock.calls[0]?.[1];
    expect(typeof raw).toBe('string');
    const saved = JSON.parse(String(raw)) as AppState;
    const item = saved.sessions[0]?.timeline[0];
    expect(item).toMatchObject({ type: 'tool', title: '读取私有文件' });
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('rawInput');
    expect(item).not.toHaveProperty('rawOutput');
    expect(item).not.toHaveProperty('locations');
  });

  it('stores the latest plan and finalizes a streamed turn', () => {
    const planned = reducer(stateFixture(), {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: '检查实现', priority: 'high', status: 'completed' },
          { content: '运行测试', priority: 'medium', status: 'in_progress' },
        ],
      },
    });
    const streaming = reducer(planned, {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '完成。' },
      },
    });
    const done = reducer(streaming, {
      type: 'ACP_UPDATE',
      sessionId: 'local-session',
      update: { sessionUpdate: 'client_turn_complete', stopReason: 'end_turn' },
    });

    expect(done.sessions[0]?.status).toBe('completed');
    expect(done.sessions[0]?.timeline).toMatchObject([
      { type: 'plan', entries: [{ status: 'completed' }, { status: 'in_progress' }] },
      { type: 'message', streaming: false },
      { type: 'status', tone: 'success' },
    ]);
  });

  it('routes permission requests to the matching local session', () => {
    const requested = reducer(stateFixture(), {
      type: 'PERMISSION_REQUEST',
      request: {
        requestId: 'permission-1',
        sessionId: 'acp-session',
        toolCall: { title: '写入文件' },
        options: [{ optionId: 'allow-once', name: '允许一次', kind: 'allow_once' }],
      },
    });
    expect(requested.sessions[0]?.status).toBe('awaiting_permission');
    expect(requested.pendingPermissions[0]?.requestId).toBe('permission-1');

    const cleared = reducer(requested, {
      type: 'PERMISSION_CLEARED',
      requestId: 'permission-1',
    });
    expect(cleared.sessions[0]?.status).toBe('working');
    expect(cleared.pendingPermissions).toHaveLength(0);
  });

  it('queues concurrent permission requests without losing either session', () => {
    const secondSession = sessionFixture({
      id: 'local-session-2',
      projectId: 'project-2',
      acpSessionId: 'acp-session-2',
    });
    const state = { ...stateFixture(), sessions: [sessionFixture(), secondSession] };
    const first = reducer(state, {
      type: 'PERMISSION_REQUEST',
      request: {
        requestId: 'permission-1',
        sessionId: 'acp-session',
        toolCall: { title: '写入文件' },
        options: [],
      },
    });
    const queued = reducer(first, {
      type: 'PERMISSION_REQUEST',
      request: {
        requestId: 'permission-2',
        sessionId: 'acp-session-2',
        toolCall: { title: '运行命令' },
        options: [],
      },
    });
    const cleared = reducer(queued, {
      type: 'PERMISSION_CLEARED',
      requestId: 'permission-1',
    });

    expect(queued.pendingPermissions.map((request) => request.requestId)).toEqual([
      'permission-1',
      'permission-2',
    ]);
    expect(cleared.pendingPermissions[0]?.requestId).toBe('permission-2');
    expect(cleared.sessions.find((session) => session.id === 'local-session')?.status).toBe(
      'working',
    );
    expect(cleared.sessions.find((session) => session.id === 'local-session-2')?.status).toBe(
      'awaiting_permission',
    );
  });

  it('does not revive a terminal session when an expired permission is cleared', () => {
    const requested = reducer(stateFixture(), {
      type: 'PERMISSION_REQUEST',
      request: {
        requestId: 'permission-expired',
        sessionId: 'acp-session',
        toolCall: { title: '等待超时' },
        options: [],
      },
    });
    const completed = {
      ...requested,
      sessions: requested.sessions.map((session) => ({
        ...session,
        status: 'completed' as const,
      })),
    };
    const cleared = reducer(completed, {
      type: 'PERMISSION_CLEARED',
      requestId: 'permission-expired',
    });

    expect(cleared.sessions[0]?.status).toBe('completed');
    expect(cleared.pendingPermissions).toHaveLength(0);
  });
});
