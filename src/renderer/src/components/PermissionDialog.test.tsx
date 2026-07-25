// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRequestEvent } from '../../../shared/types';
import { PermissionDialog } from './PermissionDialog';

const request: PermissionRequestEvent = {
  requestId: 'permission-1',
  sessionId: 'session-background',
  workspacePath: '/workspaces/payment-service',
  expiresAt: Date.now() + 60_000,
  toolCall: {
    toolCallId: 'tool-1',
    title: '删除生成文件',
    kind: 'delete',
    status: 'pending',
    content: null,
    rawInput: { command: 'rm -rf ./generated' },
    rawOutput: null,
    locations: null,
  },
  options: [
    { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
    { optionId: 'allow-always', name: '始终允许', kind: 'allow_always' },
    { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
  ],
};

function renderDialog(
  sourceOverrides: Partial<React.ComponentProps<typeof PermissionDialog>['source']> = {},
) {
  const onResolve = vi.fn();
  const onShowSource = vi.fn();
  const source: React.ComponentProps<typeof PermissionDialog>['source'] = {
    verified: true,
    projectName: 'payment-service',
    projectPath: '/workspaces/payment-service',
    sessionTitle: '重构支付回调逻辑',
    background: true,
    onShowSource,
    ...sourceOverrides,
  };
  return {
    ...render(
      <PermissionDialog
        request={request}
        source={source}
        remainingCount={0}
        submitting={false}
        onResolve={onResolve}
      />,
    ),
    onResolve,
    onShowSource,
  };
}

describe('PermissionDialog', () => {
  afterEach(cleanup);

  it('shows the project, path, and session that originated the request', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveTextContent('payment-service');
    expect(screen.getByRole('dialog')).toHaveTextContent('/workspaces/payment-service');
    expect(screen.getByRole('dialog')).toHaveTextContent('重构支付回调逻辑');
    expect(screen.getByRole('dialog')).toHaveTextContent('这是后台会话发出的请求');
    expect(screen.getByRole('dialog')).toHaveTextContent('持续允许同类操作，请谨慎');
  });

  it('lets the user switch to the background source session before deciding', async () => {
    const user = userEvent.setup();
    const { onShowSource } = renderDialog();

    await user.click(screen.getByRole('button', { name: '切换到来源会话' }));
    expect(onShowSource).toHaveBeenCalledOnce();
  });

  it('disables allow choices when the request origin cannot be verified', () => {
    renderDialog({ verified: false });

    expect(screen.getByRole('button', { name: /允许一次/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /始终允许/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^拒绝/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: '取消这次操作' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toHaveTextContent('来源无法验证，允许选项已禁用');
  });

  it('keeps reverse tab navigation inside the dialog after submission is re-enabled', () => {
    const source = {
      verified: true,
      projectName: 'payment-service',
      projectPath: '/workspaces/payment-service',
      sessionTitle: '重构支付回调逻辑',
      background: true,
      onShowSource: vi.fn(),
    };
    const onResolve = vi.fn();
    const view = render(
      <PermissionDialog
        request={request}
        source={source}
        remainingCount={0}
        submitting
        onResolve={onResolve}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();

    view.rerender(
      <PermissionDialog
        request={request}
        source={source}
        remainingCount={0}
        submitting={false}
        onResolve={onResolve}
      />,
    );
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '取消这次操作' })).toHaveFocus();
  });
});
