import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';
import { buildConnectionDiagnostic, connectionView } from '../lib/connection';
import { OrbitMark } from './OrbitMark';

interface SettingsDialogProps {
  open: boolean;
  version: string;
  platform: string;
  arch: string;
  connectionStatus: ConnectionStatus;
  connectionDetail: string;
  connectionIssueCode: ConnectionIssueCode | null;
  binaryPath: string | null;
  cliVersion: string | null;
  agentName: string | null;
  agentVersion: string | null;
  onRetryConnection: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  open,
  version,
  platform,
  arch,
  connectionStatus,
  connectionDetail,
  connectionIssueCode,
  binaryPath,
  cliVersion,
  agentName,
  agentVersion,
  onRetryConnection,
  onClose,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const connected = connectionStatus === 'ready';
  const busy =
    connectionStatus === 'checking' ||
    connectionStatus === 'detected' ||
    connectionStatus === 'connecting';
  const connection = connectionView(connectionStatus, connectionIssueCode);
  const diagnostic = useMemo(
    () =>
      buildConnectionDiagnostic({
        status: connectionStatus,
        detail: connectionDetail,
        issueCode: connectionIssueCode,
        binaryPath,
        cliVersion,
        agentName,
        agentVersion,
        appVersion: version,
        platform,
        arch,
      }),
    [
      agentName,
      agentVersion,
      arch,
      binaryPath,
      cliVersion,
      connectionDetail,
      connectionIssueCode,
      connectionStatus,
      platform,
      version,
    ],
  );

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      (connected
        ? dialogRef.current?.querySelector<HTMLButtonElement>('[data-close]')
        : retryRef.current
      )?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      returnFocusRef.current?.focus();
    };
  }, [connected, open]);

  if (!open) return null;

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copyDiagnostic = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the visual backdrop dismisses the modal.
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        ref={dialogRef}
        className="settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header>
          <div>
            <OrbitMark size={30} active={connected || busy} />
            <span>
              <strong id="settings-title">连接中心与设置</strong>
              <small>
                星轨工作台 {version} · {platform}/{arch}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭连接中心"
            data-close
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-dialog__content">
          <section>
            <h3>本机 Grok Build</h3>
            <div className="connection-panel settings-connection-panel">
              <div className="connection-header">
                <div>
                  <h2>{connection.title}</h2>
                  <p>{connection.summary}</p>
                </div>
                <span className="connection-status__icon">
                  {connected ? (
                    <Check size={18} />
                  ) : busy ? (
                    <RefreshCw size={17} />
                  ) : (
                    <CircleAlert size={18} />
                  )}
                </span>
              </div>
              <div
                className={`connection-status ${
                  connected ? 'is-connected' : busy ? 'is-checking' : 'is-error'
                }`}
                role="status"
              >
                <span className="connection-status__icon">
                  <TerminalSquare size={17} />
                </span>
                <span>
                  <strong>{connection.label}</strong>
                  <small>{connectionDetail || connection.summary}</small>
                </span>
              </div>
              <dl className="connection-meta">
                <dt>CLI 版本</dt>
                <dd>{cliVersion ?? '未读取'}</dd>
                <dt>CLI 路径</dt>
                <dd>{binaryPath ?? '未检测到'}</dd>
                <dt>ACP Agent</dt>
                <dd>
                  {[agentName, agentVersion].filter(Boolean).join(' ') ||
                    (connected ? '已连接（代理未报告版本）' : '尚未连接')}
                </dd>
                <dt>问题代码</dt>
                <dd>{connectionIssueCode ?? '无'}</dd>
              </dl>
              <div className="connection-actions">
                <button
                  ref={retryRef}
                  type="button"
                  className="is-primary"
                  onClick={onRetryConnection}
                  disabled={busy}
                >
                  <RefreshCw size={15} /> {busy ? '正在连接…' : connected ? '重新检测' : '重新连接'}
                </button>
                <button type="button" onClick={() => void copyDiagnostic()}>
                  <Copy size={15} /> {copied ? '已复制' : '复制脱敏诊断'}
                </button>
                <a href="https://docs.x.ai/build/overview" target="_blank" rel="noreferrer">
                  安装与登录说明 <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </section>
          <section>
            <h3>连接不成功时</h3>
            <ol className="troubleshooting-list">
              <li>
                在终端运行 <code>grok --version</code>，确认 CLI 可以启动。
              </li>
              <li>若提示身份验证失败，先在终端按 Grok 指引完成登录。</li>
              <li>返回这里点击“重新连接”；仍失败时复制脱敏诊断用于反馈。</li>
            </ol>
          </section>
          <section>
            <h3>权限与隐私</h3>
            <div className="setting-row setting-row--stacked">
              <ShieldCheck size={17} />
              <div>
                <strong>密钥留在本机 Grok Build</strong>
                <small>界面不读取或存储认证文件。敏感工具调用会标明工作区和会话来源。</small>
              </div>
            </div>
          </section>
          <section>
            <h3>关于</h3>
            <p className="about-copy">
              星轨工作台是独立开发的非官方中文图形客户端，通过 Grok Build CLI 的 ACP 接口工作，与
              xAI 无隶属或背书关系。
            </p>
          </section>
        </div>
        <footer>
          <span>开源 Alpha · Apache-2.0</span>
          <button type="button" onClick={onClose} data-close>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
