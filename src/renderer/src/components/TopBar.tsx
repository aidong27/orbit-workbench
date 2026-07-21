import { Bot, GitBranch, PanelRightClose, PanelRightOpen, RefreshCw, Sparkles } from 'lucide-react';
import { modeLabel, statusLabel } from '../lib/format';
import type { WorkSession, WorkspaceProject } from '../state/model';

interface TopBarProps {
  project: WorkspaceProject | null;
  session: WorkSession | null;
  inspectorOpen: boolean;
  connectionStatus: string;
  onToggleInspector: () => void;
  onRefreshProject: () => void;
}

export function TopBar({
  project,
  session,
  inspectorOpen,
  connectionStatus,
  onToggleInspector,
  onRefreshProject,
}: TopBarProps) {
  return (
    <header className="topbar app-drag">
      <div className="topbar__context no-drag">
        <div className="topbar__title">
          <strong>{session?.title ?? '新建任务'}</strong>
          {session?.demo && <span className="preview-badge">界面预览</span>}
          {session?.continuity === 'local-history-only' && !session.demo && (
            <span className="history-badge">仅本地历史</span>
          )}
        </div>
        <div className="topbar__meta">
          <span>{project?.name ?? '尚未选择工作区'}</span>
          {project?.isGitRepository && (
            <span>
              <GitBranch size={12} />
              {project.branch}
            </span>
          )}
          {project && project.changedFiles > 0 && (
            <button type="button" onClick={onRefreshProject} title="刷新 Git 状态">
              <RefreshCw size={11} />
              {project.changedFiles} 项变更
            </button>
          )}
        </div>
      </div>

      <div className="topbar__actions no-drag">
        <div className={`engine-pill engine-pill--${connectionStatus}`} title="本机 Grok ACP 状态">
          <span className="engine-pill__pulse" />
          <Bot size={14} />
          <span>Grok Build</span>
        </div>
        <div className="mode-pill" title="会话模式可在输入框中切换">
          <Sparkles size={13} />
          <span>{modeLabel(session?.confirmedModeId ?? null)}</span>
        </div>
        {session && (
          <span className={`session-state session-state--${session.status}`}>
            {statusLabel(session.status)}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={onToggleInspector}
          aria-label={inspectorOpen ? '收起检查器' : '打开检查器'}
        >
          {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </header>
  );
}
