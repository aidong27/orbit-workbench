import {
  ChevronDown,
  CircleAlert,
  CircleStop,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';
import { shouldSubmitComposerKey } from '../lib/composer-input';
import { connectionView } from '../lib/connection';
import { modeLabel } from '../lib/format';
import { sessionBlocksInput, type WorkSession, type WorkspaceProject } from '../state/model';

interface ComposerProps {
  project: WorkspaceProject | null;
  session: WorkSession | null;
  value: string;
  connectionStatus: ConnectionStatus;
  connectionIssueCode: ConnectionIssueCode | null;
  connectionDetail: string;
  focusBlocked: boolean;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onModeChange: (modeId: string) => void;
  onNewSession: () => void;
  onRetryConnection: () => void;
  onOpenConnectionCenter: () => void;
}

export function Composer({
  project,
  session,
  value,
  connectionStatus,
  connectionIssueCode,
  connectionDetail,
  focusBlocked,
  onValueChange,
  onSend,
  onStop,
  onModeChange,
  onNewSession,
  onRetryConnection,
  onOpenConnectionCenter,
}: ComposerProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modeFocusIndex, setModeFocusIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusBlockedRef = useRef(focusBlocked);
  const modeRootRef = useRef<HTMLFieldSetElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modeItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isWorking = session ? sessionBlocksInput(session.status) : false;
  const connected = connectionStatus === 'ready';
  const connectionBusy =
    connectionStatus === 'checking' ||
    connectionStatus === 'detected' ||
    connectionStatus === 'connecting';
  const connection = connectionView(connectionStatus, connectionIssueCode);
  const isHistoryOnly = session?.continuity === 'local-history-only';
  const modeDisabled =
    !connected ||
    isWorking ||
    isHistoryOnly ||
    session?.modeSwitchStatus === 'switching' ||
    !session;
  const canStop = Boolean(session?.acpSessionId && isWorking);
  const canSend = Boolean(
    project &&
      !project.demo &&
      session &&
      connected &&
      !isHistoryOnly &&
      value.trim() &&
      !isWorking &&
      session.modeSwitchStatus !== 'switching',
  );
  const activeSessionId = session?.id;
  const selectedModeId = session?.confirmedModeId ?? session?.requestedModeId ?? null;
  const modes = session?.availableModes.length
    ? session.availableModes
    : [
        { id: 'normal', name: '普通' },
        { id: 'plan', name: '计划' },
      ];
  const modeButtonLabel =
    session?.modeSwitchStatus === 'switching'
      ? `正在切换到${modeLabel(session.requestedModeId)}`
      : session?.confirmedModeId
        ? modeLabel(session.confirmedModeId)
        : session?.requestedModeId
          ? `${modeLabel(session.requestedModeId)}（未确认）`
          : '跟随 Grok（首条任务时确认）';

  focusBlockedRef.current = focusBlocked;
  useEffect(() => {
    if (activeSessionId && !focusBlockedRef.current) textareaRef.current?.focus();
  }, [activeSessionId]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!modeRootRef.current?.contains(event.target as Node)) setModeMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      modeItemRefs.current[modeFocusIndex]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modeFocusIndex, modeMenuOpen]);

  const openModeMenu = (focusIndex: number): void => {
    setModeFocusIndex(Math.max(0, Math.min(focusIndex, modes.length - 1)));
    setModeMenuOpen(true);
  };

  const closeModeMenu = (returnFocus: boolean): void => {
    setModeMenuOpen(false);
    if (returnFocus) modeButtonRef.current?.focus();
  };

  const onModeButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault();
      openModeMenu(0);
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault();
      openModeMenu(modes.length - 1);
    } else if (event.key === 'Escape' && modeMenuOpen) {
      event.preventDefault();
      closeModeMenu(true);
    }
  };

  const onModeMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeModeMenu(true);
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (modeFocusIndex + 1) % modes.length;
    if (event.key === 'ArrowUp') nextIndex = (modeFocusIndex - 1 + modes.length) % modes.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = modes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setModeFocusIndex(nextIndex);
  };

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
    return null;
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
      {!connected && (
        <div className="notice notice--warning composer-connection-notice" role="status">
          <CircleAlert size={16} />
          <span>
            <strong>{connection.title}</strong>
            <small>{connectionDetail || connection.summary} 草稿会保留，但暂时不能发送。</small>
          </span>
          <div className="notice-actions">
            <button type="button" onClick={onRetryConnection} disabled={connectionBusy}>
              <RefreshCw size={14} /> {connectionBusy ? '连接中…' : '重试'}
            </button>
            <button type="button" onClick={onOpenConnectionCenter}>
              <Settings2 size={14} /> 诊断
            </button>
          </div>
        </div>
      )}
      <div className={`composer ${isWorking ? 'composer--working' : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            connected
              ? `在 ${project.name} 中交给 Grok 一个任务…`
              : '可以先写下任务；连接成功后再发送…'
          }
          aria-label="任务输入"
        />
        <div className="composer__toolbar">
          <div className="composer__tools">
            <fieldset
              className="mode-select"
              ref={modeRootRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setModeMenuOpen(false);
              }}
            >
              <legend className="visually-hidden">会话模式</legend>
              <button
                ref={modeButtonRef}
                type="button"
                onClick={() => {
                  if (modeMenuOpen) {
                    setModeMenuOpen(false);
                    return;
                  }
                  openModeMenu(
                    Math.max(
                      0,
                      modes.findIndex((mode) => mode.id === selectedModeId),
                    ),
                  );
                }}
                onKeyDown={onModeButtonKeyDown}
                disabled={modeDisabled}
                aria-busy={session?.modeSwitchStatus === 'switching'}
                aria-expanded={modeMenuOpen}
                aria-haspopup="menu"
                aria-controls={modeMenuOpen ? 'composer-mode-menu' : undefined}
              >
                <Sparkles size={13} />
                {modeButtonLabel}
                <ChevronDown size={12} />
              </button>
              {modeMenuOpen && (
                <div
                  className="mode-menu"
                  id="composer-mode-menu"
                  role="menu"
                  onKeyDown={onModeMenuKeyDown}
                >
                  {modes.map((mode, index) => (
                    <button
                      ref={(element) => {
                        modeItemRefs.current[index] = element;
                      }}
                      type="button"
                      key={mode.id}
                      className={mode.id === selectedModeId ? 'is-active' : ''}
                      role="menuitemradio"
                      aria-checked={mode.id === selectedModeId}
                      tabIndex={index === modeFocusIndex ? 0 : -1}
                      onClick={() => {
                        closeModeMenu(true);
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
            </fieldset>
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
        {!connected ? (
          <span className="composer-hint__error">Grok 尚未连接 · 当前内容仅保存在草稿中</span>
        ) : session?.modeSwitchStatus === 'failed' ? (
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
