// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    showConnectionNotice: true,
    focusBlocked: false,
    onValueChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onModeChange: vi.fn(),
    onNewSession: vi.fn(),
    onNewSessionWithDraft: vi.fn(),
    onRetryConnection: vi.fn(),
    onOpenConnectionCenter: vi.fn(),
    ...overrides,
  };
  return { ...render(<Composer {...props} />), props };
}

describe('Composer', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it('does not move focus behind a permission dialog when the active session changes', () => {
    const first = makeSession({ id: 'session-1' });
    const second = makeSession({ id: 'session-2' });
    const rendered = renderComposer(first, { focusBlocked: true });
    const textbox = screen.getByRole('textbox', { name: '任务输入' });

    expect(textbox).not.toHaveFocus();
    rendered.rerender(<Composer {...rendered.props} session={second} focusBlocked />);
    expect(textbox).not.toHaveFocus();
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
    const onNewSessionWithDraft = vi.fn();
    renderComposer(makeSession({ continuity: 'local-history-only', acpSessionId: null }), {
      onNewSession,
      onNewSessionWithDraft,
    });

    expect(screen.queryByRole('textbox', { name: '任务输入' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('这是本地历史记录，Grok 上下文未恢复');
    expect(screen.getByRole('textbox', { name: '保留的未发送草稿' })).toHaveValue('执行刚才的方案');

    await user.click(screen.getByRole('button', { name: '新建任务并带上草稿' }));
    expect(onNewSessionWithDraft).toHaveBeenCalledWith('执行刚才的方案');
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

  it('uses a roving keyboard focus model for available modes', async () => {
    renderComposer(makeSession());

    const modeButton = screen.getByRole('button', { name: /计划/ });
    fireEvent.keyDown(modeButton, { key: 'ArrowDown' });
    const normalMode = screen.getByRole('menuitemradio', { name: /普通/ });
    const planMode = screen.getByRole('menuitemradio', { name: /计划/ });
    await waitFor(() => expect(normalMode).toHaveFocus());

    fireEvent.keyDown(normalMode, { key: 'ArrowUp' });
    await waitFor(() => expect(planMode).toHaveFocus());
    fireEvent.keyDown(planMode, { key: 'Home' });
    await waitFor(() => expect(normalMode).toHaveFocus());
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

  it('hides the duplicated connection notice while keeping the compact footer hint', () => {
    renderComposer(makeSession(), {
      connectionStatus: 'error',
      connectionIssueCode: 'timeout',
      connectionDetail: '连接 Grok ACP 超时。',
      showConnectionNotice: false,
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Grok 尚未连接 · 当前内容仅保存在草稿中')).toBeInTheDocument();
  });

  it('resizes when a template fills the draft and caps long input at 220 pixels', () => {
    const rendered = renderComposer(makeSession(), { value: '' });
    const textbox = screen.getByRole('textbox', {
      name: '任务输入',
    }) as HTMLTextAreaElement;
    let measuredHeight = 28;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get: () => measuredHeight,
    });

    rendered.rerender(<Composer {...rendered.props} value="" />);
    expect(textbox.style.height).toBe('52px');
    expect(textbox.style.overflowY).toBe('hidden');

    measuredHeight = 148;
    rendered.rerender(<Composer {...rendered.props} value={'第一行\n第二行\n第三行'} />);
    expect(textbox.style.height).toBe('148px');
    expect(textbox.style.overflowY).toBe('hidden');

    measuredHeight = 420;
    rendered.rerender(<Composer {...rendered.props} value={'很长的任务说明\n'.repeat(40)} />);
    expect(textbox.style.height).toBe('220px');
    expect(textbox.style.overflowY).toBe('auto');
  });

  it('remeasures the draft after switching sessions', () => {
    const rendered = renderComposer(makeSession({ id: 'session-1' }));
    const textbox = screen.getByRole('textbox', {
      name: '任务输入',
    }) as HTMLTextAreaElement;
    let measuredHeight = 132;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get: () => measuredHeight,
    });

    rendered.rerender(
      <Composer {...rendered.props} session={makeSession({ id: 'session-1' })} value="多行草稿" />,
    );
    expect(textbox.style.height).toBe('132px');

    measuredHeight = 30;
    rendered.rerender(
      <Composer {...rendered.props} session={makeSession({ id: 'session-2' })} value="短草稿" />,
    );
    expect(screen.getByRole('textbox', { name: '任务输入' })).not.toBe(textbox);
    expect(screen.getByRole('textbox', { name: '任务输入' })).toHaveStyle({ height: '52px' });
  });

  it('remeasures the same draft when Windows Snap or a side panel changes its width', () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    renderComposer(makeSession());
    const textbox = screen.getByRole('textbox', {
      name: '任务输入',
    }) as HTMLTextAreaElement;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      value: 176,
    });

    expect(resizeCallbacks).toHaveLength(1);
    resizeCallbacks[0]?.(
      [
        {
          target: textbox,
          contentRect: { width: 320 },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );

    expect(textbox.style.height).toBe('176px');
  });
});
