import { describe, expect, it } from 'vitest';
import type { AppState, WorkSession } from './model';
import { reducer } from './reducer';

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
    pendingPermission: null,
    sidebarCollapsed: false,
    inspectorOpen: true,
    inspectorTab: 'changes',
    commandPaletteOpen: false,
    settingsOpen: false,
    appVersion: 'test',
  };
}

describe('Grok ACP 状态归一化', () => {
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
    expect(requested.pendingPermission?.requestId).toBe('permission-1');

    const cleared = reducer(requested, {
      type: 'PERMISSION_CLEARED',
      requestId: 'permission-1',
    });
    expect(cleared.sessions[0]?.status).toBe('working');
    expect(cleared.pendingPermission).toBeNull();
  });
});
