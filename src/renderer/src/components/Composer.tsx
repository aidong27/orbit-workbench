import { ChevronDown, CircleStop, CornerDownLeft, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { shouldSubmitComposerKey } from '../lib/composer-input';
import { modeLabel } from '../lib/format';
import { sessionBlocksInput, type WorkSession, type WorkspaceProject } from '../state/model';

interface ComposerProps {
  project: WorkspaceProject | null;
  session: WorkSession | null;
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onModeChange: (modeId: string) => void;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
}

export function Composer({
  project,
  session,
  value,
  onValueChange,
  onSend,
  onStop,
  onModeChange,
  onNewSession,
  onOpenWorkspace,
}: ComposerProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isWorking = session ? sessionBlocksInput(session.status) : false;
  const isHistoryOnly = session?.continuity === 'local-history-only';
  const modeDisabled =
    isWorking || isHistoryOnly || session?.modeSwitchStatus === 'switching' || !session;
  const canStop = Boolean(session?.acpSessionId && isWorking);
  const canSend = Boolean(
    project &&
      !project.demo &&
      session &&
      !isHistoryOnly &&
      value.trim() &&
      !isWorking &&
      session.modeSwitchStatus !== 'switching',
  );
  const activeSessionId = session?.id;
  const selectedModeId = session?.confirmedModeId ?? session?.requestedModeId ?? null;
  const modeButtonLabel =
    session?.modeSwitchStatus === 'switching'
      ? `正在切换到${modeLabel(session.requestedModeId)}`
      : session?.confirmedModeId
        ? modeLabel(session.confirmedModeId)
        : session?.requestedModeId
          ? `${modeLabel(session.requestedModeId)}（未确认）`
          : '跟随 Grok（待连接确认）';

  useEffect(() => {
    if (activeSessionId) textareaRef.current?.focus();
  }, [activeSessionId]);

  const submit = (): void => {
    const prompt = value.trim();
    if (!prompt || !canSend) return;
    onSend(prompt);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      shouldSubmitComposerKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.nativeEvent.keyCode,
      })
    ) {
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

  if (isHistoryOnly) {
    return (
      <div className="composer-shell composer-shell--history-only">
        <div className="history-only-cta" role="status">
          <ShieldCheck size={17} />
          <span>
            <strong>这是本地历史记录，Grok 上下文未恢复</strong>
            <small>为避免伪连续，不能在这段记录中直接续写。新任务不会携带旧对话。</small>
          </span>
          <button type="button" onClick={onNewSession}>
            新建空白任务
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-shell">
      <div className={`composer ${isWorking ? 'composer--working' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`在 ${project.name} 中交给 Grok 一个任务…`}
          aria-label="任务输入"
        />
        <div className="composer__toolbar">
          <div className="composer__tools">
            <div className="mode-select">
              <button
                type="button"
                onClick={() => setModeMenuOpen((open) => !open)}
                disabled={modeDisabled}
                aria-busy={session?.modeSwitchStatus === 'switching'}
              >
                <Sparkles size={13} />
                {modeButtonLabel}
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
                      className={mode.id === selectedModeId ? 'is-active' : ''}
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
        {session?.modeSwitchStatus === 'failed' ? (
          <span className="composer-hint__error">模式未切换：{session.modeSwitchError}</span>
        ) : (
          <span>
            <ShieldCheck size={12} /> 本机执行 · 权限可控
          </span>
        )}
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}
