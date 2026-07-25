// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';

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
  });

  it('shows actionable connection metadata and retries without restarting the app', async () => {
    const user = userEvent.setup();
    const onRetryConnection = vi.fn();
    render(
      <SettingsDialog
        open
        version="0.2.0-alpha.3"
        platform="darwin"
        arch="arm64"
        connectionStatus="error"
        connectionDetail="连接 Grok ACP 超时。"
        connectionIssueCode="timeout"
        binaryPath="/Users/test/.grok/bin/grok"
        cliVersion="grok 0.2.112"
        agentName={null}
        agentVersion={null}
        onRetryConnection={onRetryConnection}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('/Users/test/.grok/bin/grok');
    expect(screen.getByRole('dialog')).toHaveTextContent('grok 0.2.112');
    expect(screen.getByRole('dialog')).toHaveTextContent('timeout');
    const retry = screen.getByRole('button', { name: /重新连接/ });
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(onRetryConnection).toHaveBeenCalledOnce();
  });
});
