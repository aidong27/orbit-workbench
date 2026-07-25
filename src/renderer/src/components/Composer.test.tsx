// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkSession, WorkspaceProject } from '../state/model';
import { Composer } from './Composer';

const project: WorkspaceProject = {
  id: 'project-1',
  path: '/workspaces/payment-service',
  name: 'payment-service',
  branch: 'main',
  isGitRepository: true,
  changedFiles: 0,
  statusLines: [],
  diffStat: '',
  addedAt: 1,
};

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'session-1',
    projectId: project.id,
    title: '支付回调重构',
    acpSessionId: 'acp-session-1',
    status: 'idle',
    timeline: [],
    createdAt: 1,
    updatedAt: 1,
    continuity: 'live',
    confirmedModeId: 'plan',
    requestedModeId: 'plan',
    modeSwitchStatus: 'idle',
    modeSwitchError: null,
    modeRequestId: 0,
    availableModes: [
      { id: 'normal', name: '普通' },
      { id: 'plan', name: '计划' },
    ],
    availableCommands: [],
    configOptions: [],
    ...overrides,
  };
}

function renderComposer(
  session: WorkSession,
  overrides: Partial<React.ComponentProps<typeof Composer>> = {},
) {
  const props: React.ComponentProps<typeof Composer> = {
    project,
    session,
    value: '执行刚才的方案',
    connectionStatus: 'ready',
    connectionIssueCode: null,
    connectionDetail: '已连接',
    onValueChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onModeChange: vi.fn(),
    onNewSession: vi.fn(),
    onRetryConnection: vi.fn(),
    onOpenConnectionCenter: vi.fn(),
    ...overrides,
  };
  return { ...render(<Composer {...props} />), props };
}

describe('Composer', () => {
  afterEach(cleanup);

  it('does not send when Enter confirms a Chinese IME composition', () => {
    const onSend = vi.fn();
    renderComposer(makeSession(), { onSend });

    fireEvent.keyDown(screen.getByRole('textbox', { name: '任务输入' }), {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends once for a plain Enter after composition has ended', () => {
    const onSend = vi.fn();
    renderComposer(makeSession(), { onSend });

    fireEvent.keyDown(screen.getByRole('textbox', { name: '任务输入' }), {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('执行刚才的方案');
  });

  it('makes a restored local-history session read-only and starts a blank task explicitly', async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    renderComposer(makeSession({ continuity: 'local-history-only', acpSessionId: null }), {
      onNewSession,
    });

    expect(screen.queryByRole('textbox', { name: '任务输入' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('这是本地历史记录，Grok 上下文未恢复');

    await user.click(screen.getByRole('button', { name: '新建空白任务' }));
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('disables mode changes while a turn is running', () => {
    const onModeChange = vi.fn();
    renderComposer(makeSession({ status: 'working' }), { onModeChange });

    const modeButton = screen.getByRole('button', { name: /计划/ });
    expect(modeButton).toBeDisabled();
    fireEvent.click(modeButton);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('closes the mode menu with Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    renderComposer(makeSession());

    const modeButton = screen.getByRole('button', { name: /计划/ });
    await user.click(modeButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(modeButton).toHaveFocus();
  });

  it('does not send while a mode switch is awaiting agent confirmation', () => {
    const onSend = vi.fn();
    renderComposer(makeSession({ modeSwitchStatus: 'switching', requestedModeId: 'normal' }), {
      onSend,
    });

    const sendButton = screen.getByRole('button', { name: '发送任务' });
    expect(sendButton).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '任务输入' }), {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      isComposing: false,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the draft editable but blocks sending while Grok is disconnected', async () => {
    const onSend = vi.fn();
    const onRetryConnection = vi.fn();
    const user = userEvent.setup();
    renderComposer(makeSession(), {
      connectionStatus: 'error',
      connectionIssueCode: 'timeout',
      connectionDetail: '连接 Grok ACP 超时。',
      onSend,
      onRetryConnection,
    });

    expect(screen.getByRole('textbox', { name: '任务输入' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '发送任务' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('草稿会保留');
    await user.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetryConnection).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });
});
