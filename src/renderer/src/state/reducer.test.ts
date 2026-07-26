import { describe, expect, it } from 'vitest';
import type { SanitizedToolCall, UiAcpEvent } from '../../../shared/types';
import type { AppState, WorkSession, WorkspaceProject } from './model';
import { makeProject, makeSession, sessionBlocksInput, workspacePathKey } from './model';
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
    connectionAttemptId: 1,
    connectionIssueCode: null,
    connectionRetryable: false,
    grokBinaryPath: '/usr/local/bin/grok',
    grokCliVersion: 'grok 0.2.112',
    grokAuthenticated: true,
    grokAuthMethod: 'cached_token',
    grokLogoutSupported: true,
    grokAgentName: 'Grok Build',
    grokAgentVersion: '0.2.112',
    draftsBySessionId: {},
    autoConnectGrok: true,
    uiTextScale: 'large',
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
  it('persists drafts per session and clears only the submitted session', () => {
    const other = sessionFixture({ id: 'other-session', updatedAt: 2 });
    let state = {
      ...stateFixture(),
      sessions: [sessionFixture(), other],
    };
    state = reducer(state, {
      type: 'DRAFT_CHANGED',
      sessionId: 'local-session',
      value: '主任务草稿',
    });
    state = reducer(state, {
      type: 'DRAFT_CHANGED',
      sessionId: 'other-session',
      value: '后台草稿',
    });

    const submitted = reducer(state, {
      type: 'USER_MESSAGE',
      sessionId: 'local-session',
      text: '主任务草稿',
    });

    expect(submitted.draftsBySessionId).toEqual({ 'other-session': '后台草稿' });
    expect(submitted.sessions[0]?.timeline).toContainEqual(
      expect.objectContaining({ type: 'message', role: 'user', content: '主任务草稿' }),
    );
  });

  it('marks an explicit logout as signed out and clears stale agent metadata', () => {
    const next = reducer(stateFixture(), {
      type: 'GROK_LOGGED_OUT',
      confirmed: true,
      detail: '已退出 Grok 账号。',
    });

    expect(next).toMatchObject({
      connectionStatus: 'offline',
      connectionIssueCode: 'authentication_required',
      grokAuthenticated: false,
      grokAuthMethod: null,
      grokLogoutSupported: false,
      grokAgentName: null,
      grokAgentVersion: null,
      autoConnectGrok: false,
    });
  });

  it('does not claim the account is signed out when logout cannot be confirmed', () => {
    const next = reducer(stateFixture(), {
      type: 'GROK_LOGGED_OUT',
      confirmed: false,
      detail: 'CLI 注销命令超时。',
    });

    expect(next).toMatchObject({
      connectionStatus: 'error',
      connectionIssueCode: 'authentication_failed',
      grokAuthenticated: null,
      autoConnectGrok: false,
    });
  });

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
    expect(next.projects).toHaveLength(1);
    expect(next.projects.some((project) => project.demo)).toBe(false);
    expect(next.activeProjectId).toBe(existing.id);
  });

  it('deduplicates Windows workspace paths across drive casing and slash variants', () => {
    const existing = projectFixture({
      id: 'windows-project',
      path: String.raw`\\?\C:\Users\Alice\Projects\Orbit`,
    });
    const reopened = makeProject(
      {
        name: 'Orbit',
        path: 'c:/users/alice/projects/orbit/',
        branch: 'main',
        isGitRepository: true,
        changedFiles: 0,
        statusLines: [],
        diffStat: '',
      },
      [existing],
    );

    expect(reopened.id).toBe(existing.id);
  });

  it('normalizes Windows drive roots, UNC roots, and extended paths consistently', () => {
    expect(workspacePathKey('C:\\')).toBe(workspacePathKey('c:/'));
    expect(workspacePathKey(`${String.raw`\\Server\Share`}\\`)).toBe(
      workspacePathKey(String.raw`\\?\UNC\server\share`),
    );
    expect(workspacePathKey('//SERVER/SHARE/Orbit/')).toBe(
      workspacePathKey(String.raw`\\?\UNC\server\share\orbit`),
    );
    expect(workspacePathKey('//?/C:/Users/Alice/Orbit/')).toBe(
      workspacePathKey(String.raw`c:\users\alice\orbit`),
    );
    expect(workspacePathKey(`${String.raw`\\?\C:\Users\Alice\Orbit`}\\`)).toBe(
      workspacePathKey('c:/users/alice/orbit'),
    );
    expect(workspacePathKey(String.raw`/tmp/project\literal`)).toBe(
      String.raw`/tmp/project\literal`,
    );
    expect(workspacePathKey('/')).toBe('/');
    expect(workspacePathKey('')).toBe('');
  });

  it('keeps PROJECT_ADDED unique by both id and normalized Windows path', () => {
    const existing = projectFixture({
      id: 'same-project',
      path: String.raw`C:\Orbit`,
      name: 'old',
    });
    const state = {
      ...stateFixture(sessionFixture({ projectId: existing.id })),
      projects: [existing],
    };
    const next = reducer(state, {
      type: 'PROJECT_ADDED',
      project: projectFixture({
        id: 'same-project',
        path: `${String.raw`\\?\C:\Orbit`}\\`,
        name: 'refreshed',
      }),
    });

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]).toMatchObject({
      id: existing.id,
      name: 'refreshed',
    });
    expect(next.sessions[0]?.projectId).toBe(existing.id);
  });

  it('merges PROJECT_UPDATED path collisions and remaps sessions to the canonical project', () => {
    const driveProject = projectFixture({
      id: 'drive-project',
      path: String.raw`C:\Orbit`,
    });
    const uncProject = projectFixture({
      id: 'unc-project',
      path: String.raw`\\Server\Share\Orbit`,
    });
    const state = {
      ...stateFixture(sessionFixture({ projectId: uncProject.id })),
      projects: [driveProject, uncProject],
      activeProjectId: uncProject.id,
    };
    const next = reducer(state, {
      type: 'PROJECT_UPDATED',
      project: {
        ...uncProject,
        path: String.raw`\\?\C:\Orbit`,
        name: 'merged workspace',
      },
    });

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]).toMatchObject({
      id: driveProject.id,
      name: 'merged workspace',
    });
    expect(next.sessions[0]?.projectId).toBe(driveProject.id);
    expect(next.activeProjectId).toBe(driveProject.id);
  });

  it('heals duplicate UNC projects before PROJECT_SELECTED resolves the active session', () => {
    const canonical = projectFixture({
      id: 'canonical-project',
      path: String.raw`\\Server\Share\Orbit`,
    });
    const duplicate = projectFixture({
      id: 'duplicate-project',
      path: `${String.raw`\\?\UNC\SERVER\SHARE\Orbit`}\\`,
    });
    const duplicateSession = sessionFixture({
      id: 'duplicate-session',
      projectId: duplicate.id,
    });
    const state = {
      ...stateFixture(duplicateSession),
      projects: [canonical, duplicate],
      activeProjectId: duplicate.id,
    };
    const next = reducer(state, {
      type: 'PROJECT_SELECTED',
      projectId: duplicate.id,
    });

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.id).toBe(canonical.id);
    expect(next.sessions[0]?.projectId).toBe(canonical.id);
    expect(next.activeProjectId).toBe(canonical.id);
    expect(next.activeSessionId).toBe(duplicateSession.id);
  });

  it('keeps case-sensitive POSIX workspace paths distinct', () => {
    const existing = projectFixture({ id: 'upper-project', path: '/tmp/Orbit' });
    const reopened = makeProject(
      {
        name: 'orbit',
        path: '/tmp/orbit',
        branch: 'main',
        isGitRepository: true,
        changedFiles: 0,
        statusLines: [],
        diffStat: '',
      },
      [existing],
    );

    expect(reopened.id).not.toBe(existing.id);
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
      {
        type: 'CONNECTION_EVENT',
        event: { status: 'error', detail: 'ACP exited', issueCode: 'process_failed' },
      },
    );

    expect(disconnected.sessions[0]).toMatchObject({
      acpSessionId: null,
      continuity: 'local-history-only',
      confirmedModeId: null,
      status: 'failed',
    });
  });

  it('converges every streaming item and unfinished tool when the agent disconnects', () => {
    const disconnected = reducer(
      stateFixture(
        sessionFixture({
          status: 'awaiting_permission',
          timeline: [
            {
              id: 'answer-1',
              type: 'message',
              role: 'assistant',
              protocolMessageId: 'protocol-answer-1',
              content: 'partial answer',
              streaming: true,
              createdAt: 1,
            },
            {
              id: 'thought-1',
              type: 'thought',
              protocolMessageId: 'protocol-thought-1',
              content: 'still thinking',
              streaming: true,
              createdAt: 2,
            },
            {
              id: 'tool-pending',
              type: 'tool',
              toolCallId: 'tool-call-pending',
              title: '等待执行',
              kind: 'execute',
              status: 'pending',
              createdAt: 3,
            },
            {
              id: 'tool-running',
              type: 'tool',
              toolCallId: 'tool-call-running',
              title: '正在执行',
              kind: 'execute',
              status: 'in_progress',
              createdAt: 4,
            },
          ],
        }),
      ),
      {
        type: 'CONNECTION_EVENT',
        event: { status: 'offline', detail: 'channel closed', issueCode: 'channel_closed' },
      },
    );

    expect(disconnected.sessions[0]?.timeline).toMatchObject([
      { id: 'answer-1', streaming: false },
      { id: 'thought-1', streaming: false },
      { id: 'tool-pending', status: 'failed' },
      { id: 'tool-running', status: 'failed' },
    ]);
    expect(disconnected.sessions[0]?.status).toBe('failed');
  });

  it('keeps settings and the command palette mutually exclusive', () => {
    const withSettings = reducer(
      { ...stateFixture(), commandPaletteOpen: true },
      { type: 'SETTINGS', open: true },
    );
    expect(withSettings.settingsOpen).toBe(true);
    expect(withSettings.commandPaletteOpen).toBe(false);

    const withCommands = reducer(withSettings, { type: 'COMMAND_PALETTE', open: true });
    expect(withCommands.commandPaletteOpen).toBe(true);
    expect(withCommands.settingsOpen).toBe(false);
  });

  it('treats a detected CLI as preflight only and ignores stale connection attempts', () => {
    const checking = reducer(
      { ...stateFixture(), autoConnectGrok: false },
      { type: 'CONNECTION_ATTEMPT', attemptId: 2 },
    );
    const stale = reducer(checking, {
      type: 'CONNECTION_RESULT',
      attemptId: 1,
      result: { status: 'ready', detail: '旧连接成功' },
    });
    const inspected = reducer(stale, {
      type: 'GROK_INSPECTED',
      attemptId: 2,
      result: {
        status: 'detected',
        binaryPath: '/Users/test/.grok/bin/grok',
        version: 'grok 0.2.112',
        authenticated: null,
      },
    });

    expect(stale.connectionStatus).toBe('checking');
    expect(inspected).toMatchObject({
      connectionStatus: 'detected',
      grokBinaryPath: '/Users/test/.grok/bin/grok',
      grokCliVersion: 'grok 0.2.112',
    });

    const heldOffline = reducer(inspected, {
      type: 'CONNECTION_RESULT',
      attemptId: 2,
      result: {
        status: 'offline',
        detail: '自动连接已关闭；已检测到 Grok CLI，但当前登录状态尚未验证。',
        authenticated: null,
        retryable: true,
      },
    });
    expect(heldOffline).toMatchObject({
      connectionStatus: 'offline',
      connectionIssueCode: null,
      grokAuthenticated: null,
      autoConnectGrok: false,
    });
  });

  it('refuses to append a user message to local-only history', () => {
    const state = {
      ...stateFixture(sessionFixture({ continuity: 'local-history-only' })),
      draftsBySessionId: { 'local-session': '按刚才方案执行' },
    };
    const next = reducer(state, {
      type: 'USER_MESSAGE',
      sessionId: 'local-session',
      text: '按刚才方案执行',
    });

    expect(next.sessions[0]?.timeline).toEqual([]);
    expect(next.draftsBySessionId).toEqual({ 'local-session': '按刚才方案执行' });
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
      modeId: 'plan',
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

  it('ignores a late mode promise failure after the agent already confirmed the target', () => {
    const requested = reducer(stateFixture(), {
      type: 'MODE_SWITCH_REQUESTED',
      sessionId: 'local-session',
      modeId: 'plan',
      requestId: 3,
    });
    const agentConfirmed = reducer(requested, {
      type: 'ACP_EVENT',
      sessionId: 'local-session',
      event: { type: 'mode.confirmed', currentModeId: 'plan' },
    });
    const lateFailure = reducer(agentConfirmed, {
      type: 'MODE_SWITCH_FAILED',
      sessionId: 'local-session',
      modeId: 'plan',
      requestId: 3,
      error: 'timeout after confirmation',
    });

    expect(lateFailure.sessions[0]).toMatchObject({
      confirmedModeId: 'plan',
      requestedModeId: 'plan',
      modeSwitchStatus: 'idle',
      modeSwitchError: null,
    });
  });

  it('moves a recovered draft to a newly created session without leaving a hidden copy', () => {
    const source = {
      ...stateFixture(),
      draftsBySessionId: { 'local-session': '继续完成 Windows 检查' },
    };
    const newSession = sessionFixture({ id: 'new-session', timeline: [], continuity: 'fresh' });
    const moved = reducer(source, {
      type: 'SESSION_CREATED',
      session: newSession,
      draft: '继续完成 Windows 检查',
      sourceDraftSessionId: 'local-session',
    });

    expect(moved.activeSessionId).toBe('new-session');
    expect(moved.draftsBySessionId).toEqual({
      'new-session': '继续完成 Windows 检查',
    });
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
