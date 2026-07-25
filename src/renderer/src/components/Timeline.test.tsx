// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkSession } from '../state/model';
import { Timeline } from './Timeline';

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    title: '状态真实性回归',
    acpSessionId: null,
    status: 'failed',
    continuity: 'live',
    confirmedModeId: 'normal',
    requestedModeId: 'normal',
    modeSwitchStatus: 'idle',
    modeSwitchError: null,
    modeRequestId: 0,
    availableModes: [],
    availableCommands: [],
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
    timeline: [
      {
        id: 'tool-failed',
        type: 'tool',
        toolCallId: 'failed',
        title: '失败的命令',
        kind: 'execute',
        status: 'failed',
        createdAt: 1,
      },
      {
        id: 'tool-cancelled',
        type: 'tool',
        toolCallId: 'cancelled',
        title: '已取消的编辑',
        kind: 'edit',
        status: 'cancelled',
        createdAt: 2,
      },
      {
        id: 'tool-pending',
        type: 'tool',
        toolCallId: 'pending',
        title: '等待中的工具',
        kind: 'read',
        status: 'pending',
        createdAt: 3,
      },
    ],
    ...overrides,
  };
}

describe('Timeline', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  });

  it('renders failed and cancelled tools as terminal states without a spinner', () => {
    const { container } = render(<Timeline session={makeSession()} />);

    const failedCard = screen.getByText('失败的命令').closest('article');
    const cancelledCard = screen.getByText('已取消的编辑').closest('article');
    const pendingCard = screen.getByText('等待中的工具').closest('article');

    expect(failedCard).toHaveTextContent('失败');
    expect(failedCard?.querySelector('.tool-status__spinner')).not.toBeInTheDocument();
    expect(cancelledCard).toHaveTextContent('已停止');
    expect(cancelledCard?.querySelector('.tool-status__spinner')).not.toBeInTheDocument();
    expect(pendingCard?.querySelector('.tool-status__spinner')).toBeInTheDocument();
    expect(container.querySelectorAll('.tool-status__spinner')).toHaveLength(1);
  });

  it('labels restored history when the agent context is not live', () => {
    render(
      <Timeline
        session={makeSession({
          continuity: 'local-history-only',
          timeline: [],
        })}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      '仅本地历史：界面保留了记录，但 Grok 代理上下文没有恢复。',
    );
  });

  it('exposes plan entry states as text instead of relying on icons alone', () => {
    render(
      <Timeline
        session={makeSession({
          timeline: [
            {
              id: 'plan-1',
              type: 'plan',
              planId: 'plan-1',
              format: 'items',
              entries: [
                {
                  id: 'entry-1',
                  content: '验证 Windows 安装包',
                  status: 'in_progress',
                  priority: 'medium',
                },
              ],
              createdAt: 1,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('执行中：')).toHaveClass('visually-hidden');
    expect(screen.getByText('验证 Windows 安装包')).toBeInTheDocument();
  });

  it('disables smooth scrolling when the user prefers reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    render(<Timeline session={makeSession()} />);

    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });
});
