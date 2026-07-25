import { AlertTriangle, Ban, Copy, FolderGit2, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PermissionRequestEvent } from '../../../shared/types';
import { compactJson } from '../lib/format';

interface PermissionDialogProps {
  request: PermissionRequestEvent;
  source: {
    verified: boolean;
    projectName: string;
    projectPath: string;
    sessionTitle: string;
    background: boolean;
    onShowSource?: () => void;
  };
  remainingCount: number;
  submitting: boolean;
  onResolve: (optionId?: string, cancelled?: boolean) => void;
}

function permissionKindLabel(kind: string): string {
  switch (kind) {
    case 'allow_once':
      return '仅允许这一次';
    case 'allow_always':
      return '持续允许同类操作，请谨慎';
    case 'reject_once':
      return '拒绝这一次';
    case 'reject_always':
      return '持续拒绝同类操作';
    default:
      return '由 Grok Build 提供的选项';
  }
}

function toolRiskSummary(kind: string | null | undefined): string {
  switch (kind) {
    case 'delete':
      return '此操作可能删除工作区中的文件。请逐项核对目标路径。';
    case 'edit':
    case 'move':
      return '此操作会修改工作区内容。请核对文件和影响范围。';
    case 'execute':
      return '此操作会在本机执行命令。请核对命令、目录和参数。';
    case 'fetch':
      return '此操作可能访问网络。请确认目标地址和要发送的内容。';
    default:
      return '请确认路径、命令和影响范围符合你的预期。';
  }
}

export function PermissionDialog({
  request,
  source,
  remainingCount,
  submitting,
  onResolve,
}: PermissionDialogProps) {
  const toolTitle = request.toolCall.title ?? 'Grok 请求执行工具';
  const rawInput = compactJson(request.toolCall.rawInput);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1_000)),
  );

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const update = (): void =>
      setSecondsRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1_000)));
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [request.expiresAt]);

  useEffect(() => {
    if (submitting) dialogRef.current?.focus();
  }, [submitting]);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !submitting) {
      event.preventDefault();
      onResolve(undefined, true);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    if (document.activeElement === dialogRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
        aria-describedby="permission-description"
        aria-busy={submitting}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <div className="permission-dialog__icon">
          <ShieldCheck size={20} />
        </div>
        <div className="permission-dialog__heading">
          <span>需要你的确认</span>
          <h2 id="permission-title">{toolTitle}</h2>
          <p id="permission-description">Grok Build 在继续之前需要获得这次操作的权限。</p>
          <p>
            请求将在 {Math.floor(secondsRemaining / 60)}:
            {String(secondsRemaining % 60).padStart(2, '0')} 后自动拒绝。
          </p>
          {remainingCount > 0 && <p>完成后还有 {remainingCount} 项请求等待确认。</p>}
        </div>
        <div className={`permission-source ${source.background ? 'is-background' : ''}`}>
          <FolderGit2 size={15} />
          <dl>
            <div>
              <dt>工作区</dt>
              <dd>{source.projectName}</dd>
            </div>
            <div>
              <dt>路径</dt>
              <dd title={source.projectPath}>{source.projectPath}</dd>
            </div>
            <div>
              <dt>会话</dt>
              <dd>{source.sessionTitle}</dd>
            </div>
          </dl>
          <div className="permission-source__actions">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(source.projectPath).catch(() => undefined)
              }
              disabled={submitting}
            >
              <Copy size={13} /> 复制完整路径
            </button>
            {source.onShowSource && source.background && (
              <button type="button" onClick={source.onShowSource} disabled={submitting}>
                切换到来源会话
              </button>
            )}
          </div>
        </div>
        {rawInput && (
          <div className="permission-command">
            <TerminalSquare size={15} />
            <pre>{rawInput}</pre>
          </div>
        )}
        <div className="permission-warning">
          <AlertTriangle size={14} />
          <span>
            {!source.verified
              ? '来源无法验证，允许选项已禁用；请拒绝这次操作。'
              : source.background
                ? '这是后台会话发出的请求。请先核对工作区、路径和影响范围。'
                : toolRiskSummary(request.toolCall.kind)}
          </span>
        </div>
        <div className="permission-options">
          {request.options.map((option) => (
            <button
              type="button"
              key={option.optionId}
              className={
                option.kind === 'allow_once'
                  ? 'permission-option--primary'
                  : option.kind === 'allow_always'
                    ? 'permission-option--persistent'
                    : ''
              }
              disabled={submitting || (!source.verified && option.kind.startsWith('allow'))}
              onClick={() => onResolve(option.optionId, false)}
            >
              <span>{option.name}</span>
              <small>{permissionKindLabel(option.kind)}</small>
            </button>
          ))}
          <button
            ref={cancelRef}
            type="button"
            className="permission-option--cancel"
            disabled={submitting}
            onClick={() => onResolve(undefined, true)}
          >
            <Ban size={14} />
            <span>取消这次操作</span>
          </button>
        </div>
      </section>
    </div>
  );
}
