import { Check, FolderGit2, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';
import { connectionView } from '../lib/connection';
import type { WorkspaceProject } from '../state/model';

const STARTER_PROMPTS = [
  '只读检查这个项目，并告诉我如何在本机运行它。不要修改文件。',
  '先分析当前项目并给出一份执行计划，等我确认后再修改。',
  '检查当前 Git 变更，指出风险、遗漏的测试和可以改进的地方。',
  '帮我定位项目目前最明显的错误，先解释原因，再建议修复方案。',
];

interface EmptySessionProps {
  project: WorkspaceProject;
  connectionStatus: ConnectionStatus;
  connectionIssueCode: ConnectionIssueCode | null;
  onChoosePrompt: (prompt: string) => void;
  onRetryConnection: () => void;
  onOpenConnectionCenter: () => void;
}

export function EmptySession({
  project,
  connectionStatus,
  connectionIssueCode,
  onChoosePrompt,
  onRetryConnection,
  onOpenConnectionCenter,
}: EmptySessionProps) {
  const connected = connectionStatus === 'ready';
  const busy =
    connectionStatus === 'checking' ||
    connectionStatus === 'detected' ||
    connectionStatus === 'connecting';
  const connection = connectionView(connectionStatus, connectionIssueCode);

  return (
    <section className="empty-session" aria-labelledby="empty-session-title">
      <FolderGit2 size={34} />
      <h2 id="empty-session-title">从一个清楚、安全的任务开始</h2>
      <p>
        已打开 <strong>{project.name}</strong>
        {project.isGitRepository ? ` · ${project.branch ?? 'Git 工作区'}` : ' · 本地文件夹'}。
        点击下面的模板会把内容放进输入框，你仍可修改后再发送。
      </p>

      <div
        className={`connection-status ${
          connected ? 'is-connected' : busy ? 'is-checking' : 'is-error'
        }`}
        role="status"
      >
        <span className="connection-status__icon">
          {connected ? <Check size={17} /> : <RefreshCw size={16} />}
        </span>
        <span>
          <strong>{connection.title}</strong>
          <small>
            {connected
              ? '可以输入任务；需要执行敏感操作时，软件会显示来源和确认选项。'
              : connection.summary}
          </small>
        </span>
      </div>

      <fieldset className="empty-session__prompts">
        <legend className="visually-hidden">任务模板</legend>
        {STARTER_PROMPTS.map((prompt) => (
          <button type="button" key={prompt} onClick={() => onChoosePrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </fieldset>

      <div className="empty-session__actions">
        {!connected && (
          <button type="button" className="is-primary" onClick={onRetryConnection} disabled={busy}>
            <RefreshCw size={15} /> {busy ? '正在连接…' : '重新连接 Grok'}
          </button>
        )}
        <button type="button" onClick={onOpenConnectionCenter}>
          <Settings2 size={15} /> 连接与诊断
        </button>
      </div>
      <div className="notice notice--info">
        <ShieldCheck size={15} /> “只读”“先给计划”等边界应直接写进任务；权限弹窗会标明来源工作区。
      </div>
    </section>
  );
}
