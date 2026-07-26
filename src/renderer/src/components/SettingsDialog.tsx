import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';
import { copyText } from '../lib/clipboard';
import { buildConnectionDiagnostic, connectionView } from '../lib/connection';
import { WINDOWS_GROK_INSTALL_COMMAND } from '../lib/grok-install';
import { useCopyFeedback } from '../lib/use-copy-feedback';
import type { UiTextScale } from '../state/model';
import { OrbitMark } from './OrbitMark';

const GROK_LOGIN_COMMAND = 'grok login';

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
  authenticated: boolean | null;
  authMethod: string | null;
  logoutSupported: boolean;
  connectionRetryable: boolean;
  uiTextScale: UiTextScale;
  connectionActionsBlocked: boolean;
  logoutPending: boolean;
  onRetryConnection: () => void;
  onLogout: () => void;
  onTextScaleChange: (scale: UiTextScale) => void;
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
  authenticated,
  authMethod,
  logoutSupported,
  connectionRetryable,
  uiTextScale,
  connectionActionsBlocked,
  logoutPending,
  onRetryConnection,
  onLogout,
  onTextScaleChange,
  onClose,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const logoutTriggerRef = useRef<HTMLButtonElement>(null);
  const logoutCancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [copyStatus, reportCopy] = useCopyFeedback();
  const [installCopyStatus, reportInstallCopy] = useCopyFeedback();
  const [loginCopyStatus, reportLoginCopy] = useCopyFeedback();
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const connected = connectionStatus === 'ready';
  const busy =
    connectionStatus === 'checking' ||
    connectionStatus === 'detected' ||
    connectionStatus === 'connecting' ||
    logoutPending;
  const canRequestLogout =
    Boolean(binaryPath) &&
    connectionStatus !== 'checking' &&
    connectionStatus !== 'detected' &&
    connectionStatus !== 'connecting';
  const connection = connectionView(connectionStatus, connectionIssueCode);
  const showLoginAction =
    Boolean(binaryPath) &&
    (connected ||
      connectionIssueCode === 'authentication_required' ||
      connectionIssueCode === 'authentication_failed' ||
      connectionIssueCode === 'authentication_unsupported');
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
        authenticated,
        authMethod,
        appVersion: version,
        platform,
        arch,
      }),
    [
      agentName,
      agentVersion,
      authenticated,
      authMethod,
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
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !canRequestLogout) setLogoutConfirmationOpen(false);
  }, [canRequestLogout, open]);

  useEffect(() => {
    if (!open || !logoutConfirmationOpen) return;
    const frame = window.requestAnimationFrame(() => logoutCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [logoutConfirmationOpen, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (closeRef.current) closeRef.current.focus();
      else dialogRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (logoutConfirmationOpen) {
        setLogoutConfirmationOpen(false);
        window.setTimeout(() => logoutTriggerRef.current?.focus(), 0);
        return;
      }
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
    const copied = await copyText(diagnostic);
    reportCopy(copied);
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
        tabIndex={-1}
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
            ref={closeRef}
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
                <dd dir="ltr" title={binaryPath ?? undefined}>
                  {binaryPath ?? '未检测到'}
                </dd>
                <dt>ACP Agent</dt>
                <dd>
                  {[agentName, agentVersion].filter(Boolean).join(' ') ||
                    (connected ? '已连接（代理未报告版本）' : '尚未连接')}
                </dd>
                <dt>账号状态</dt>
                <dd>
                  {authenticated === true
                    ? '登录已验证（CLI 未报告账号）'
                    : authenticated === false
                      ? '已退出'
                      : connected
                        ? '连接可用（CLI 未报告账号）'
                        : '尚未验证'}
                </dd>
                <dt>认证方式</dt>
                <dd>{authMethod ?? 'CLI 未报告'}</dd>
                <dt>问题代码</dt>
                <dd>{connectionIssueCode ?? '无'}</dd>
              </dl>
              {platform === 'win32' && connectionIssueCode === 'binary_missing' && (
                <div className="windows-install-guide">
                  <strong>在 PowerShell 中安装 Grok CLI</strong>
                  <p>
                    此命令会从 x.ai
                    下载并执行安装脚本。运行前可先打开脚本地址审阅内容；工作台只负责复制，不会自动执行。
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
                  <small>默认安装位置：%USERPROFILE%\.grok\bin\grok.exe</small>
                </div>
              )}
              <div className="connection-actions">
                {(connected || connectionRetryable) && (
                  <button
                    type="button"
                    className="is-primary"
                    onClick={onRetryConnection}
                    disabled={busy || connectionActionsBlocked}
                  >
                    <RefreshCw size={15} />{' '}
                    {busy
                      ? '正在处理…'
                      : connected
                        ? '重启代理并重新验证'
                        : showLoginAction
                          ? '登录后重新连接'
                          : '重新连接'}
                  </button>
                )}
                {showLoginAction && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(GROK_LOGIN_COMMAND).then((copied) => reportLoginCopy(copied))
                    }
                  >
                    <TerminalSquare size={15} />{' '}
                    {loginCopyStatus === 'success'
                      ? '登录命令已复制'
                      : loginCopyStatus === 'failure'
                        ? '复制失败'
                        : '复制 grok login'}
                  </button>
                )}
                <button type="button" onClick={() => void copyDiagnostic()}>
                  <Copy size={15} />{' '}
                  {copyStatus === 'success'
                    ? '已复制'
                    : copyStatus === 'failure'
                      ? '复制失败，请重试'
                      : '复制脱敏诊断'}
                </button>
                {copyStatus !== 'idle' && (
                  <span className="visually-hidden" role="status" aria-live="polite">
                    {copyStatus === 'success' ? '脱敏诊断已复制' : '脱敏诊断复制失败'}
                  </span>
                )}
                <a href="https://docs.x.ai/build/overview" target="_blank" rel="noreferrer">
                  安装与登录说明 <ExternalLink size={14} />
                </a>
              </div>
              {connectionActionsBlocked && (
                <p className="connection-action-note" role="status">
                  当前有任务或权限确认正在进行。请先停止任务，再重启代理或退出账号。
                </p>
              )}
              {canRequestLogout && !logoutConfirmationOpen && (
                <button
                  ref={logoutTriggerRef}
                  type="button"
                  className="logout-trigger"
                  onClick={() => setLogoutConfirmationOpen(true)}
                  disabled={connectionActionsBlocked || logoutPending}
                >
                  <LogOut size={15} /> 退出或切换 Grok 账号
                </button>
              )}
              {canRequestLogout && logoutConfirmationOpen && (
                <div className="logout-confirmation" role="alert">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>确定退出 Grok CLI 当前登录？</strong>
                    <p>
                      本地代理会停止，正在运行的 ACP 会话将失效；工作区、历史和未发送草稿会保留。
                    </p>
                    <small>
                      {!connected
                        ? '即使 ACP 当前未连接，也会调用官方 Grok CLI 清除可能存在的登录。'
                        : logoutSupported
                          ? '将使用 ACP 注销，并调用官方 CLI 再次确认。'
                          : '当前 Agent 未声明 ACP 注销能力，将停止代理后调用官方 CLI 注销。'}
                    </small>
                  </div>
                  <div className="logout-confirmation__actions">
                    <button
                      ref={logoutCancelRef}
                      type="button"
                      onClick={() => {
                        setLogoutConfirmationOpen(false);
                        window.setTimeout(() => logoutTriggerRef.current?.focus(), 0);
                      }}
                      disabled={logoutPending}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => {
                        setLogoutConfirmationOpen(false);
                        onLogout();
                      }}
                      disabled={logoutPending}
                    >
                      {logoutPending ? '正在退出…' : '确认退出账号'}
                    </button>
                  </div>
                </div>
              )}
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
            <h3>界面可读性</h3>
            <div className="setting-row readability-setting">
              <Type size={17} />
              <div>
                <strong>文字大小</strong>
                <small>大字模式会放大正文、控件和辅助信息，并保持布局自适应。</small>
              </div>
              <fieldset className="segmented-control">
                <legend className="visually-hidden">文字大小</legend>
                <button
                  type="button"
                  className={uiTextScale === 'standard' ? 'is-active' : ''}
                  aria-pressed={uiTextScale === 'standard'}
                  onClick={() => onTextScaleChange('standard')}
                >
                  标准
                </button>
                <button
                  type="button"
                  className={uiTextScale === 'large' ? 'is-active' : ''}
                  aria-pressed={uiTextScale === 'large'}
                  onClick={() => onTextScaleChange('large')}
                >
                  大字
                </button>
              </fieldset>
            </div>
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
