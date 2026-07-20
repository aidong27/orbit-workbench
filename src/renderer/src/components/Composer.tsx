import {
  AtSign,
  ChevronDown,
  CircleStop,
  Command,
  CornerDownLeft,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { modeLabel } from '../lib/format';
import { sessionBlocksInput, type WorkSession, type WorkspaceProject } from '../state/model';

interface ComposerProps {
  project: WorkspaceProject | null;
  session: WorkSession | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onModeChange: (modeId: string) => void;
  onOpenWorkspace: () => void;
}

export function Composer({
  project,
  session,
  onSend,
  onStop,
  onModeChange,
  onOpenWorkspace,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isWorking = session ? sessionBlocksInput(session.status) : false;
  const canStop = Boolean(session?.acpSessionId);
  const canSend = Boolean(project && !project.demo && session && value.trim() && !isWorking);
  const activeSessionId = session?.id;

  useEffect(() => {
    if (activeSessionId) textareaRef.current?.focus();
  }, [activeSessionId]);

  const submit = (): void => {
    const prompt = value.trim();
    if (!prompt || !canSend) return;
    setValue('');
    onSend(prompt);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  if (!project || project.demo) {
    return (
      <div className="composer-shell composer-shell--onboarding">
        <button type="button" className="open-workspace-cta" onClick={onOpenWorkspace}>
          <span className="open-workspace-cta__icon">
            <Sparkles size={17} />
          </span>
          <span>
            <strong>打开本地工作区，开始真实任务</strong>
            <small>会通过 ACP 连接本机 Grok Build；权限请求会在界面中确认</small>
          </span>
          <CornerDownLeft size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="composer-shell">
      <div className={`composer ${isWorking ? 'composer--working' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`在 ${project.name} 中交给 Grok 一个任务…`}
          aria-label="任务输入"
        />
        <div className="composer__toolbar">
          <div className="composer__tools">
            <button type="button" title="添加附件（即将支持）" disabled>
              <Paperclip size={15} />
            </button>
            <button type="button" title="文件引用即将支持" disabled>
              <AtSign size={15} />
            </button>
            <button type="button" title="斜杠命令即将支持" disabled>
              <Command size={14} />
            </button>
            <span className="composer__divider" />
            <div className="mode-select">
              <button type="button" onClick={() => setModeMenuOpen((open) => !open)}>
                <Sparkles size={13} />
                {modeLabel(session?.currentModeId ?? null)}
                <ChevronDown size={12} />
              </button>
              {modeMenuOpen && (
                <div className="mode-menu">
                  {(session?.availableModes.length
                    ? session.availableModes
                    : [
                        { id: 'normal', name: '普通' },
                        { id: 'plan', name: '计划' },
                      ]
                  ).map((mode) => (
                    <button
                      type="button"
                      key={mode.id}
                      className={mode.id === session?.currentModeId ? 'is-active' : ''}
                      onClick={() => {
                        setModeMenuOpen(false);
                        onModeChange(mode.id);
                      }}
                    >
                      <span>
                        <strong>{modeLabel(mode.id)}</strong>
                        <small>
                          {mode.description ??
                            (mode.id === 'plan' ? '先形成计划，再执行改动' : '直接协作完成任务')}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isWorking ? (
            <button
              type="button"
              className="composer__stop"
              onClick={onStop}
              disabled={!canStop}
              title={canStop ? '停止当前任务' : '正在建立 Grok 会话'}
            >
              <CircleStop size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="composer__send"
              onClick={submit}
              disabled={!canSend}
              title="发送任务"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        <span>
          <ShieldCheck size={12} /> 本机执行 · 权限可控
        </span>
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}
