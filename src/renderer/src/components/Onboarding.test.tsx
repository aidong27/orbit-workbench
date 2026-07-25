// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '../state/model';
import { EmptySession } from './EmptySession';
import { Welcome } from './Welcome';

const project: WorkspaceProject = {
  id: 'project-1',
  path: '/workspaces/orbit',
  name: 'orbit',
  branch: 'main',
  isGitRepository: true,
  changedFiles: 0,
  statusLines: [],
  diffStat: '',
  addedAt: 1,
};

describe('connection onboarding', () => {
  afterEach(cleanup);

  it('does not call a detected CLI connected before ACP is ready', () => {
    render(
      <Welcome
        connectionStatus="detected"
        connectionDetail="已检测到 CLI，正在连接…"
        connectionIssueCode={null}
        binaryPath="/Users/test/.grok/bin/grok"
        cliVersion="grok 0.2.112"
        onRetryConnection={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenConnectionCenter={vi.fn()}
      />,
    );

    expect(screen.getByText('CLI 已检测')).toBeInTheDocument();
    expect(screen.queryByText('Grok Build 已连接')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开本地工作区/ })).not.toBeInTheDocument();
  });

  it('opens a workspace only after the ACP connection is ready', async () => {
    const user = userEvent.setup();
    const onOpenWorkspace = vi.fn();
    render(
      <Welcome
        connectionStatus="ready"
        connectionDetail="已通过 ACP 连接本机 Grok Build"
        connectionIssueCode={null}
        binaryPath="/Users/test/.grok/bin/grok"
        cliVersion="grok 0.2.112"
        onRetryConnection={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenConnectionCenter={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /打开本地工作区/ }));
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
  });

  it('places a safe starter prompt into the session draft without sending it', async () => {
    const user = userEvent.setup();
    const onChoosePrompt = vi.fn();
    render(
      <EmptySession
        project={project}
        connectionStatus="ready"
        connectionIssueCode={null}
        onChoosePrompt={onChoosePrompt}
        onRetryConnection={vi.fn()}
        onOpenConnectionCenter={vi.fn()}
      />,
    );

    const prompt = screen.getByRole('button', { name: /只读检查这个项目/ });
    await user.click(prompt);
    expect(onChoosePrompt).toHaveBeenCalledWith(
      '只读检查这个项目，并告诉我如何在本机运行它。不要修改文件。',
    );
  });

  it('offers recovery actions when the current workspace cannot reach Grok', async () => {
    const user = userEvent.setup();
    const onRetryConnection = vi.fn();
    const onOpenConnectionCenter = vi.fn();
    render(
      <EmptySession
        project={project}
        connectionStatus="error"
        connectionIssueCode="timeout"
        onChoosePrompt={vi.fn()}
        onRetryConnection={onRetryConnection}
        onOpenConnectionCenter={onOpenConnectionCenter}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('连接 Grok 超时');
    await user.click(screen.getByRole('button', { name: /重新连接 Grok/ }));
    await user.click(screen.getByRole('button', { name: /连接与诊断/ }));
    expect(onRetryConnection).toHaveBeenCalledOnce();
    expect(onOpenConnectionCenter).toHaveBeenCalledOnce();
  });
});
