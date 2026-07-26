// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOWS_GROK_INSTALL_COMMAND } from '../lib/grok-install';
import { SettingsDialog } from './SettingsDialog';

function usabilityProps(): Pick<
  React.ComponentProps<typeof SettingsDialog>,
  | 'authenticated'
  | 'authMethod'
  | 'logoutSupported'
  | 'connectionRetryable'
  | 'uiTextScale'
  | 'connectionActionsBlocked'
  | 'logoutPending'
  | 'onLogout'
  | 'onTextScaleChange'
> {
  return {
    authenticated: null,
    authMethod: null,
    logoutSupported: false,
    connectionRetryable: true,
    uiTextScale: 'large',
    connectionActionsBlocked: false,
    logoutPending: false,
    onLogout: vi.fn(),
    onTextScaleChange: vi.fn(),
  };
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  it('shows actionable connection metadata and retries without restarting the app', async () => {
    const user = userEvent.setup();
    const onRetryConnection = vi.fn();
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.4"
        platform="darwin"
        arch="arm64"
        connectionStatus="error"
        connectionDetail="连接 Grok ACP 超时。"
        connectionIssueCode="timeout"
        binaryPath="/Users/test/.grok/bin/grok"
        cliVersion="grok 0.2.112"
        agentName={null}
        agentVersion={null}
        {...usabilityProps()}
        onRetryConnection={onRetryConnection}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('/Users/test/.grok/bin/grok');
    expect(screen.getByRole('dialog')).toHaveTextContent('grok 0.2.112');
    expect(screen.getByRole('dialog')).toHaveTextContent('timeout');
    const retry = screen.getByRole('button', { name: /重新连接/ });
    expect(screen.getByRole('button', { name: '关闭连接中心' })).toHaveFocus();
    await user.click(retry);
    expect(onRetryConnection).toHaveBeenCalledOnce();
  });

  it('keeps busy-state focus inside the modal and restores the original trigger on close', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const props: React.ComponentProps<typeof SettingsDialog> = {
      open: true,
      version: '0.2.0-alpha.4',
      platform: 'win32',
      arch: 'x64',
      connectionStatus: 'checking',
      connectionDetail: '正在检测',
      connectionIssueCode: null,
      binaryPath: null,
      cliVersion: null,
      agentName: null,
      agentVersion: null,
      ...usabilityProps(),
      onRetryConnection: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<SettingsDialog {...props} />);

    expect(screen.getByRole('button', { name: '关闭连接中心' })).toHaveFocus();
    view.rerender(<SettingsDialog {...props} open={false} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('does not recapture the modal as the return target when connection status changes', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const props: React.ComponentProps<typeof SettingsDialog> = {
      open: true,
      version: '0.2.0-alpha.4',
      platform: 'win32',
      arch: 'x64',
      connectionStatus: 'error',
      connectionDetail: '连接失败',
      connectionIssueCode: 'timeout',
      binaryPath: null,
      cliVersion: null,
      agentName: null,
      agentVersion: null,
      ...usabilityProps(),
      onRetryConnection: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<SettingsDialog {...props} />);
    expect(screen.getByRole('button', { name: '关闭连接中心' })).toHaveFocus();

    view.rerender(
      <SettingsDialog
        {...props}
        connectionStatus="ready"
        connectionDetail="已连接"
        connectionIssueCode={null}
      />,
    );
    view.rerender(<SettingsDialog {...props} open={false} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('copies a Windows diagnostic and reports success', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const binaryPath = String.raw`C:\Users\测试用户\AppData\Local\Programs\Grok\grok.exe`;
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.4"
        platform="win32"
        arch="x64"
        connectionStatus="ready"
        connectionDetail="已连接"
        connectionIssueCode={null}
        binaryPath={binaryPath}
        cliVersion="grok 0.2.112"
        agentName="Grok Build"
        agentVersion="0.2.112"
        {...usabilityProps()}
        onRetryConnection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '复制脱敏诊断' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain(
      String.raw`CLI 路径: %USERPROFILE%\AppData\Local\Programs\Grok\grok.exe`,
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain('测试用户');
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('offers a copy-only PowerShell install command when the Windows binary is missing', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.4"
        platform="win32"
        arch="x64"
        connectionStatus="offline"
        connectionDetail="未找到 Grok CLI"
        connectionIssueCode="binary_missing"
        binaryPath={null}
        cliVersion={null}
        agentName={null}
        agentVersion={null}
        {...usabilityProps()}
        onRetryConnection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(WINDOWS_GROK_INSTALL_COMMAND)).toBeInTheDocument();
    expect(screen.getByText(/工作台只负责复制，不会自动执行/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制 PowerShell 安装命令' }));
    expect(writeText).toHaveBeenCalledWith(WINDOWS_GROK_INSTALL_COMMAND);
  });

  it('requires confirmation before logging out and explains that account identity is unavailable', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.5"
        platform="darwin"
        arch="arm64"
        connectionStatus="ready"
        connectionDetail="ACP 连接可用"
        connectionIssueCode={null}
        binaryPath="/Users/test/.grok/bin/grok"
        cliVersion="grok 0.2.112"
        agentName="Grok Build"
        agentVersion="0.2.112"
        {...usabilityProps()}
        authenticated
        authMethod="Cached token"
        logoutSupported
        onLogout={onLogout}
        onRetryConnection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('登录已验证（CLI 未报告账号）')).toBeInTheDocument();
    const logoutTrigger = screen.getByRole('button', { name: '退出或切换 Grok 账号' });
    await user.click(logoutTrigger);
    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.getByText(/工作区、历史和未发送草稿会保留/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: '确认退出账号' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '退出或切换 Grok 账号' })).toHaveFocus(),
    );

    await user.click(screen.getByRole('button', { name: '退出或切换 Grok 账号' }));
    await user.click(screen.getByRole('button', { name: '确认退出账号' }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '确认退出账号' })).not.toBeInTheDocument();
  });

  it('can clear cached CLI login even when ACP authentication did not connect', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.5"
        platform="win32"
        arch="x64"
        connectionStatus="error"
        connectionDetail="Grok 身份验证失败"
        connectionIssueCode="authentication_failed"
        binaryPath={String.raw`C:\Users\test\.grok\bin\grok.exe`}
        cliVersion="grok 0.2.112"
        agentName={null}
        agentVersion={null}
        {...usabilityProps()}
        onLogout={onLogout}
        onRetryConnection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '退出或切换 Grok 账号' }));
    expect(screen.getByText(/即使 ACP 当前未连接/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认退出账号' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('changes the persisted readability preference from the settings surface', async () => {
    const user = userEvent.setup();
    const onTextScaleChange = vi.fn();
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.5"
        platform="win32"
        arch="x64"
        connectionStatus="offline"
        connectionDetail="已退出"
        connectionIssueCode="authentication_required"
        binaryPath={String.raw`C:\Users\test\.grok\bin\grok.exe`}
        cliVersion="grok 0.2.112"
        agentName={null}
        agentVersion={null}
        {...usabilityProps()}
        authenticated={false}
        uiTextScale="standard"
        onTextScaleChange={onTextScaleChange}
        onRetryConnection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const large = screen.getByRole('button', { name: '大字' });
    expect(large).toHaveAttribute('aria-pressed', 'false');
    await user.click(large);
    expect(onTextScaleChange).toHaveBeenCalledWith('large');
  });
});
