import { describe, expect, it } from 'vitest';
import type { SanitizedToolCall, UiAcpEvent } from '../../../shared/types';
import type { AppState, WorkSession, WorkspaceProject } from './model';
import { makeProject, makeSession, sessionBlocksInput } from './model';
import { reducer } from './reducer';

function projectFixture(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
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
    continuity: 'live',
    confirmedModeId: 'normal',
    requestedModeId: 'normal',
    modeSwitchStatus: 'idle',
    modeSwitchError: null,
    modeRequestId: 0,
    availableModes: [],
    availableCommands: [],
    configOptions: [],
    ...overrides,
  };
}

function stateFixture(session = sessionFixture()): AppState {
  return {
    projects: [projectFixture()],
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

function toolCall(overrides: Partial<SanitizedToolCall> = {}): SanitizedToolCall {
  return {
    toolCallId: 'tool-1',
    ...overrides,
  };
}

function applyEvent(state: AppState, event: UiAcpEvent): AppState {
  return reducer(state, { type: 'ACP_EVENT', sessionId: 'local-session', event });
}

describe('Grok ACP 状态归一化', () => {
  it('blocks input for every non-converged turn state', () => {
    expect(sessionBlocksInput('awaiting_permission')).toBe(true);
    expect(sessionBlocksInput('working')).toBe(true);
    expect(sessionBlocksInput('cancelling')).toBe(true);
    expect(sessionBlocksInput('completed')).toBe(false);
  });

  it('reuses the stored project id and removes demo entities after opening a real workspace', () => {
    const existing = projectFixture({ id: 'stored-project', path: '/tmp/workspace' });
    const demo = projectFixture({ id: 'demo-project', path: '', demo: true });
    const state = {
      ...stateFixture(sessionFixture({ projectId: existing.id })),
      projects: [demo, existing],
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
    const next = reducer(state, { type: 'PROJECT_ADDED', project: reopened });

    expect(reopened.id).toBe(existing.id);
    expect(next.projects).toHaveLength(2);
    expect(next.activeProjectId).toBe(existing.id);
  });

  it('marks disconnected sessions as local history instead of silently recreating context', () => {
    const disconnected = reducer(
      stateFixture(
        sessionFixture({
          status: 'working',
          timeline: [
            {
              id: 'user-1',
              type: 'message',
              role: 'user',
              content: '不要修改数据库',
              createdAt: 1,
            },
          ],
        }),
      ),
      { type: 'CONNECTION', status: 'error', detail: 'ACP exited' },
    );

    expect(disconnected.sessions[0]).toMatchObject({
      acpSessionId: null,
      continuity: 'local-history-only',
      confirmedModeId: null,
      status: 'failed',
    });
  });

  it('refuses to append a user message to local-only history', () => {
    const state = stateFixture(sessionFixture({ continuity: 'local-history-only' }));
    const next = reducer(state, {
      type: 'USER_MESSAGE',
      sessionId: 'local-session',
      text: '按刚才方案执行',
    });

    expect(next.sessions[0]?.timeline).toEqual([]);
  });

  it('coalesces interleaved chunks by message id instead of timeline position', () => {
    let state = applyEvent(stateFixture(), {
      type: 'message.chunk',
      role: 'assistant',
      messageId: 'message-a',
      text: 'A1',
    });
    state = applyEvent(state, {
      type: 'message.chunk',
      role: 'assistant',
      messageId: 'message-b',
      text: 'B1',
    });
    state = applyEvent(state, {
      type: 'tool.upsert',
      toolCall: toolCall({ title: '读取文件', status: 'completed' }),
    });
    state = applyEvent(state, {
      type: 'message.chunk',
      role: 'assistant',
      messageId: 'message-a',
      text: 'A2',
    });

    expect(state.sessions[0]?.timeline).toMatchObject([
      { type: 'message', protocolMessageId: 'message-a', content: 'A1A2' },
      { type: 'message', protocolMessageId: 'message-b', content: 'B1' },
      { type: 'tool' },
    ]);
  });

  it('uses adjacent compatibility merging only when messageId is absent', () => {
    const first = applyEvent(stateFixture(), {
      type: 'thought.chunk',
      messageId: null,
      text: '正在',
    });
    const second = applyEvent(first, {
      type: 'thought.chunk',
      messageId: null,
      text: '分析',
    });

    expect(second.sessions[0]?.timeline).toMatchObject([
      { type: 'thought', content: '正在分析', protocolMessageId: null },
    ]);
  });

  it('updates partial tool calls in place and converges failed tools', () => {
    const created = applyEvent(stateFixture(), {
      type: 'tool.upsert',
      toolCall: toolCall({
        title: '运行测试',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'pnpm test' },
      }),
    });
    const updated = applyEvent(created, {
      type: 'tool.upsert',
      toolCall: toolCall({ status: 'completed', rawOutput: '42 tests passed' }),
    });
    const cleared = applyEvent(updated, {
      type: 'tool.upsert',
      toolCall: toolCall({ title: null, rawInput: null }),
    });
    const failed = applyEvent(created, { type: 'turn.failed', detail: '通道关闭' });

    expect(updated.sessions[0]?.timeline[0]).toMatchObject({
      type: 'tool',
      title: '运行测试',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'pnpm test' },
      rawOutput: '42 tests passed',
    });
    expect(failed.sessions[0]?.timeline[0]).toMatchObject({ status: 'failed' });
    expect(cleared.sessions[0]?.timeline[0]).toMatchObject({
      title: '执行工具',
      rawInput: null,
      rawOutput: '42 tests passed',
    });
  });

  it('does not preserve a stale tool status when the protocol explicitly clears it', () => {
    const completed = applyEvent(stateFixture(), {
      type: 'tool.upsert',
      toolCall: toolCall({ status: 'completed' }),
    });
    const cleared = applyEvent(completed, {
      type: 'tool.upsert',
      toolCall: toolCall({ status: null }),
    });

    expect(cleared.sessions[0]?.timeline[0]).toMatchObject({ status: 'unknown' });
  });

  it('keeps multiple plan ids, all plan formats, empty plans, and targeted removal', () => {
    let state = applyEvent(stateFixture(), {
      type: 'plan.items',
      planId: 'plan-a',
      entries: [],
      truncated: false,
    });
    state = applyEvent(state, {
      type: 'plan.markdown',
      planId: 'plan-b',
      markdown: '# 计划',
      truncated: false,
    });
    state = applyEvent(state, {
      type: 'plan.file',
      planId: 'plan-c',
      uri: 'file:///workspace/PLAN.md',
      truncated: false,
    });
    state = applyEvent(state, { type: 'plan.remove', planId: 'plan-b' });

    expect(state.sessions[0]?.timeline).toMatchObject([
      { type: 'plan', planId: 'plan-a', format: 'items', entries: [] },
      { type: 'plan', planId: 'plan-c', format: 'file' },
    ]);
  });

  it('keeps a baseline null plan id distinct from a literal legacy-plan id', () => {
    let state = applyEvent(stateFixture(), {
      type: 'plan.items',
      planId: null,
      entries: [],
      truncated: false,
    });
    state = applyEvent(state, {
      type: 'plan.markdown',
      planId: 'legacy-plan',
      markdown: '# 独立计划',
      truncated: true,
    });
    state = applyEvent(state, { type: 'plan.remove', planId: 'legacy-plan' });

    expect(state.sessions[0]?.timeline).toMatchObject([
      { type: 'plan', planId: null, format: 'items' },
    ]);
  });

  it('gives duplicate plan entries distinct stable keys', () => {
    const event: UiAcpEvent = {
      type: 'plan.items',
      planId: 'plan-a',
      entries: [
        { content: '运行测试', priority: 'high', status: 'pending' },
        { content: '运行测试', priority: 'medium', status: 'completed' },
      ],
      truncated: false,
    };
    const first = applyEvent(stateFixture(), event);
    const second = applyEvent(first, event);
    const firstPlan = first.sessions[0]?.timeline[0];
    const secondPlan = second.sessions[0]?.timeline[0];
    if (firstPlan?.type !== 'plan' || firstPlan.format !== 'items') throw new Error('missing plan');
    if (secondPlan?.type !== 'plan' || secondPlan.format !== 'items')
      throw new Error('missing plan');

    expect(new Set(firstPlan.entries.map((entry) => entry.id)).size).toBe(2);
    expect(secondPlan.entries.map((entry) => entry.id)).toEqual(
      firstPlan.entries.map((entry) => entry.id),
    );
  });

  it('treats confirmed and requested modes as separate transactional facts', () => {
    const requested = reducer(stateFixture(), {
      type: 'MODE_SWITCH_REQUESTED',
      sessionId: 'local-session',
      modeId: 'plan',
      requestId: 1,
    });
    expect(requested.sessions[0]).toMatchObject({
      confirmedModeId: 'normal',
      requestedModeId: 'plan',
      modeSwitchStatus: 'switching',
    });

    const failed = reducer(requested, {
      type: 'MODE_SWITCH_FAILED',
      sessionId: 'local-session',
      requestId: 1,
      error: 'agent rejected mode',
    });
    expect(failed.sessions[0]).toMatchObject({
      confirmedModeId: 'normal',
      requestedModeId: 'normal',
      modeSwitchStatus: 'failed',
    });

    const stale = reducer(failed, {
      type: 'MODE_SWITCH_CONFIRMED',
      sessionId: 'local-session',
      modeId: 'plan',
      requestId: 0,
    });
    expect(stale.sessions[0]?.confirmedModeId).toBe('normal');
  });

  it('stores commands, config, and typed usage as full replacements', () => {
    let state = applyEvent(stateFixture(), {
      type: 'commands.replace',
      commands: [{ name: 'review', description: '审查', inputHint: null }],
      truncated: false,
    });
    state = applyEvent(state, {
      type: 'config.replace',
      configOptions: [
        {
          type: 'boolean',
          id: 'thinking',
          name: '深度思考',
          description: null,
          category: 'thought_level',
          currentValue: true,
        },
      ],
      truncated: false,
    });
    state = applyEvent(state, {
      type: 'usage.replace',
      usage: { used: 4_096, size: 128_000, cost: null },
    });

    expect(state.sessions[0]).toMatchObject({
      availableCommands: [{ name: 'review' }],
      availableCommandsTruncated: false,
      configOptions: [{ id: 'thinking', currentValue: true }],
      configOptionsTruncated: false,
      usage: { used: 4_096, size: 128_000 },
    });
  });

  it('retains turn usage and treats max turn requests as a warning terminal state', () => {
    const usage = {
      totalTokens: 100,
      inputTokens: 60,
      outputTokens: 40,
      thoughtTokens: null,
      cachedReadTokens: null,
      cachedWriteTokens: null,
    };
    const state = applyEvent(stateFixture(), {
      type: 'turn.completed',
      stopReason: 'max_turn_requests',
      usage,
    });

    expect(state.sessions[0]?.lastTurnUsage).toEqual(usage);
    expect(state.sessions[0]?.timeline.at(-1)).toMatchObject({ tone: 'warning' });
  });

  it('routes permission requests and does not revive terminal sessions when cleared', () => {
    const requested = reducer(stateFixture(), {
      type: 'PERMISSION_REQUEST',
      request: {
        requestId: 'permission-1',
        sessionId: 'acp-session',
        workspacePath: '/tmp/project-1',
        expiresAt: Date.now() + 1_000,
        toolCall: toolCall({ title: '写入文件' }),
        options: [{ optionId: 'allow-once', name: '允许一次', kind: 'allow_once' }],
      },
    });
    expect(requested.sessions[0]?.status).toBe('awaiting_permission');

    const completed = {
      ...requested,
      sessions: requested.sessions.map((session) => ({ ...session, status: 'completed' as const })),
    };
    const cleared = reducer(completed, {
      type: 'PERMISSION_CLEARED',
      requestId: 'permission-1',
    });
    expect(cleared.sessions[0]?.status).toBe('completed');
    expect(cleared.pendingPermissions).toHaveLength(0);
  });

  it('bounds long in-memory timelines', () => {
    let state = stateFixture();
    for (let index = 0; index < 620; index += 1) {
      state = reducer(state, {
        type: 'USER_MESSAGE',
        sessionId: 'local-session',
        text: `message-${index}`,
      });
    }
    expect(state.sessions[0]?.timeline).toHaveLength(600);
  });

  it('creates fresh sessions with no falsely confirmed mode', () => {
    const session = makeSession('project-1');
    expect(session).toMatchObject({
      continuity: 'fresh',
      confirmedModeId: null,
      requestedModeId: null,
    });
  });
});
