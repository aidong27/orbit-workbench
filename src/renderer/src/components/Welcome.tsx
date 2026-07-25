import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Settings2,
  TerminalSquare,
} from 'lucide-react';
import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';
import { copyText } from '../lib/clipboard';
import { connectionView } from '../lib/connection';
import { WINDOWS_GROK_INSTALL_COMMAND } from '../lib/grok-install';
import { useCopyFeedback } from '../lib/use-copy-feedback';
import { OrbitMark } from './OrbitMark';

interface WelcomeProps {
  connectionStatus: ConnectionStatus;
  connectionDetail: string;
  connectionIssueCode: ConnectionIssueCode | null;
  platform: string;
  binaryPath: string | null;
  cliVersion: string | null;
  onRetryConnection: () => void;
  onOpenWorkspace: () => void;
  onOpenConnectionCenter: () => void;
}

function stepClass(complete: boolean, active: boolean, failed = false): string {
  if (complete) return 'setup-step is-complete';
  if (failed) return 'setup-step is-error';
  if (active) return 'setup-step is-active';
  return 'setup-step';
}

export function Welcome({
  connectionStatus,
  connectionDetail,
  connectionIssueCode,
  platform,
  binaryPath,
  cliVersion,
  onRetryConnection,
  onOpenWorkspace,
  onOpenConnectionCenter,
}: WelcomeProps) {
  const [installCopyStatus, reportInstallCopy] = useCopyFeedback();
  const connection = connectionView(connectionStatus, connectionIssueCode);
  const cliDetected = Boolean(binaryPath);
  const connecting =
    connectionStatus === 'checking' ||
    connectionStatus === 'detected' ||
    connectionStatus === 'connecting';
  const connected = connectionStatus === 'ready';
  const failed = connectionStatus === 'offline' || connectionStatus === 'error';
  const showWindowsInstall = platform === 'win32' && connectionIssueCode === 'binary_missing';

  return (
    <div className="welcome-scroll">
      <section className="setup-screen" aria-labelledby="setup-title">
        <OrbitMark size={54} active={connecting || connected} />
        <p className="setup-eyebrow">GROK BUILD · 中文桌面工作台</p>
        <h1 id="setup-title">先连接 Grok，再开始第一个任务</h1>
        <p className="setup-lead">
          星轨工作台调用你本机安装的 Grok Build CLI。下面会依次检测程序、验证 ACP
          连接，再让你选择项目目录；认证信息不会进入这个界面。
        </p>

        <ol className="setup-steps" aria-label="首次设置进度">
          <li
            className={stepClass(
              cliDetected,
              connectionStatus === 'checking',
              failed && !cliDetected,
            )}
          >
            <span className="setup-step__index">{cliDetected ? <Check size={16} /> : '1'}</span>
            <span>
              <strong>检测 CLI</strong>
              <small>{cliDetected ? '已找到本机程序' : '查找 grok / grok.exe'}</small>
            </span>
          </li>
          <li
            className={stepClass(
              connected,
              connectionStatus === 'detected' || connectionStatus === 'connecting',
              connectionStatus === 'error',
            )}
          >
            <span className="setup-step__index">{connected ? <Check size={16} /> : '2'}</span>
            <span>
              <strong>连接 ACP</strong>
              <small>{connected ? '协议与认证完成' : '启动并验证本机代理'}</small>
            </span>
          </li>
          <li className={stepClass(false, connected)}>
            <span className="setup-step__index">3</span>
            <span>
              <strong>选择工作区</strong>
              <small>打开要交给 Grok 的目录</small>
            </span>
          </li>
          <li className="setup-step">
            <span className="setup-step__index">4</span>
            <span>
              <strong>描述任务</strong>
              <small>从安全的中文模板开始</small>
            </span>
          </li>
        </ol>

        <section className="connection-panel">
          <div className="connection-header">
            <div>
              <h2>{connection.title}</h2>
              <p>{connection.summary}</p>
            </div>
            <span className={`connection-status__icon is-${connection.tone}`}>
              {failed ? <CircleAlert size={18} /> : <TerminalSquare size={18} />}
            </span>
          </div>

          <div
            className={`connection-status ${
              connected
                ? 'is-connected'
                : failed
                  ? connectionIssueCode === 'binary_missing'
                    ? 'is-missing'
                    : 'is-error'
                  : 'is-checking'
            }`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="connection-status__icon">
              {connected ? <Check size={17} /> : connecting ? <RefreshCw size={16} /> : '!'}
            </span>
            <span>
              <strong>{connection.label}</strong>
              <small>{connectionDetail || connection.summary}</small>
            </span>
          </div>

          {(binaryPath || cliVersion) && (
            <dl className="connection-meta">
              <dt>CLI 版本</dt>
              <dd>{cliVersion ?? '已检测，版本未知'}</dd>
              <dt>程序路径</dt>
              <dd dir="ltr" title={binaryPath ?? undefined}>
                {binaryPath ?? '未检测到'}
              </dd>
            </dl>
          )}

          {showWindowsInstall && (
            <div className="windows-install-guide">
              <strong>在 PowerShell 中安装 Grok CLI</strong>
              <p>
                此命令会从 x.ai 下载并执行安装脚本。建议先打开脚本地址审阅内容，再在 PowerShell
                中运行；工作台只负责复制。
              </p>
              <code dir="ltr">{WINDOWS_GROK_INSTALL_COMMAND}</code>
              <a href="https://x.ai/cli/install.ps1" target="_blank" rel="noreferrer">
                运行前审阅 install.ps1 <ExternalLink size={13} />
              </a>
              <button
                type="button"
                onClick={() =>
                  void copyText(WINDOWS_GROK_INSTALL_COMMAND).then((copied) => {
                    reportInstallCopy(copied);
                  })
                }
              >
                <Copy size={14} />{' '}
                {installCopyStatus === 'success'
                  ? '安装命令已复制'
                  : installCopyStatus === 'failure'
                    ? '复制失败，请手动选择命令'
                    : '复制 PowerShell 安装命令'}
              </button>
              {installCopyStatus !== 'idle' && (
                <span className="visually-hidden" role="status" aria-live="polite">
                  {installCopyStatus === 'success'
                    ? 'PowerShell 安装命令已复制'
                    : 'PowerShell 安装命令复制失败'}
                </span>
              )}
              <small>
                工作台不会自动执行此命令；默认安装位置为 %USERPROFILE%\.grok\bin\grok.exe。
              </small>
            </div>
          )}

          <div className="connection-actions">
            {connected ? (
              <button type="button" className="is-primary" onClick={onOpenWorkspace}>
                <FolderOpen size={16} /> 打开本地工作区 <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="is-primary"
                onClick={onRetryConnection}
                disabled={connecting}
              >
                <RefreshCw size={15} /> {connecting ? '正在连接…' : '重新检测并连接'}
              </button>
            )}
            <button type="button" onClick={onOpenConnectionCenter}>
              <Settings2 size={15} /> 查看连接诊断
            </button>
            {!connected && (
              <a href="https://docs.x.ai/build/overview" target="_blank" rel="noreferrer">
                官方安装说明 <ExternalLink size={14} />
              </a>
            )}
          </div>
        </section>
        <p className="welcome__disclaimer">
          非官方开源 Alpha · 工作区内容和认证由本机 Grok Build 处理 · 敏感操作会先请求权限
        </p>
      </section>
    </div>
  );
}
