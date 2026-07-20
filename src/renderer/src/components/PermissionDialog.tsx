import { AlertTriangle, Ban, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { PermissionRequestEvent } from '../../../shared/types';
import { compactJson } from '../lib/format';

interface PermissionDialogProps {
  request: PermissionRequestEvent;
  remainingCount: number;
  onResolve: (optionId?: string, cancelled?: boolean) => void;
}

export function PermissionDialog({ request, remainingCount, onResolve }: PermissionDialogProps) {
  const toolTitle = String(request.toolCall.title ?? 'Grok 请求执行工具');
  const rawInput = compactJson(request.toolCall.rawInput);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
      >
        <div className="permission-dialog__icon">
          <ShieldCheck size={20} />
        </div>
        <div className="permission-dialog__heading">
          <span>需要你的确认</span>
          <h2 id="permission-title">{toolTitle}</h2>
          <p>Grok Build 在继续之前需要获得这次操作的权限。</p>
          {remainingCount > 0 && <p>完成后还有 {remainingCount} 项请求等待确认。</p>}
        </div>
        {rawInput && (
          <div className="permission-command">
            <TerminalSquare size={15} />
            <pre>{rawInput}</pre>
          </div>
        )}
        <div className="permission-warning">
          <AlertTriangle size={14} />
          <span>请确认路径、命令和影响范围符合你的预期。</span>
        </div>
        <div className="permission-options">
          {request.options.map((option, index) => (
            <button
              type="button"
              key={option.optionId}
              className={
                option.kind.includes('allow') || index === 0 ? 'permission-option--primary' : ''
              }
              onClick={() => onResolve(option.optionId, false)}
            >
              <span>{option.name}</span>
              <small>{option.kind}</small>
            </button>
          ))}
          <button
            type="button"
            className="permission-option--cancel"
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
