import {
  Command,
  FolderGit2,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { connectionView } from '../lib/connection';
import { statusLabel, timeAgo } from '../lib/format';
import type { AppState } from '../state/model';
import { OrbitMark } from './OrbitMark';

interface SidebarProps {
  state: AppState;
  onOpenWorkspace: () => void;
  onNewSession: () => void;
  onSelectProject: (id: string) => void;
  onSelectSession: (id: string) => void;
  onToggle: () => void;
  onOpenCommands: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  state,
  onOpenWorkspace,
  onNewSession,
  onSelectProject,
  onSelectSession,
  onToggle,
  onOpenCommands,
  onOpenSettings,
}: SidebarProps) {
  const shortcutPrefix = state.appPlatform === 'darwin' ? '⌘' : 'Ctrl+';
  if (state.sidebarCollapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <div className="sidebar__traffic-spacer" />
        <button
          type="button"
          className="icon-button sidebar__collapse"
          onClick={onToggle}
          aria-label="展开边栏"
        >
          <PanelLeftOpen size={17} />
        </button>
        <OrbitMark size={28} active={state.connectionStatus === 'ready'} />
        <button
          type="button"
          className="sidebar__rail-action"
          onClick={onNewSession}
          aria-label="新建任务"
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          className="sidebar__rail-action"
          onClick={onOpenWorkspace}
          aria-label="打开工作区"
        >
          <FolderOpen size={18} />
        </button>
        <div className="sidebar__rail-spacer" />
        <button
          type="button"
          className="sidebar__rail-action"
          onClick={onOpenSettings}
          aria-label="设置"
        >
          <Settings size={17} />
        </button>
      </aside>
    );
  }

  const activeProjectSessions = state.sessions
    .filter((session) => session.projectId === state.activeProjectId)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand app-drag">
        <div className="sidebar__brand-copy">
          <OrbitMark size={28} active={state.connectionStatus === 'ready'} />
          <div>
            <strong>星轨工作台</strong>
            <span>Grok Build 中文客户端</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-button no-drag"
          onClick={onToggle}
          aria-label="收起边栏"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="sidebar__primary-actions">
        <button type="button" className="new-task-button" onClick={onNewSession}>
          <Plus size={16} />
          <span>新建任务</span>
          <kbd>{shortcutPrefix}N</kbd>
        </button>
        <button type="button" className="command-button" onClick={onOpenCommands}>
          <Search size={15} />
          <span>命令</span>
          <kbd>{shortcutPrefix}K</kbd>
        </button>
      </div>

      <nav className="sidebar__scroll" aria-label="工作区和会话">
        <section className="sidebar-section">
          <div className="sidebar-section__heading">
            <span>工作区</span>
            <button type="button" onClick={onOpenWorkspace} aria-label="添加工作区">
              <Plus size={14} />
            </button>
          </div>
          <div className="workspace-list">
            {state.projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={
                  project.id === state.activeProjectId ? 'workspace-row is-active' : 'workspace-row'
                }
                aria-current={project.id === state.activeProjectId ? 'page' : undefined}
                onClick={() => onSelectProject(project.id)}
                title={project.path || project.name}
              >
                <FolderGit2 size={15} />
                <span className="workspace-row__copy">
                  <strong>{project.name}</strong>
                  <small>{project.demo ? '可交互演示' : (project.branch ?? '非 Git 工作区')}</small>
                </span>
                {project.changedFiles > 0 && <em>{project.changedFiles}</em>}
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section sidebar-section--sessions">
          <div className="sidebar-section__heading">
            <span>最近任务</span>
          </div>
          <div className="session-list">
            {activeProjectSessions.length === 0 ? (
              <button type="button" className="session-empty" onClick={onNewSession}>
                在此工作区创建第一个任务
              </button>
            ) : (
              activeProjectSessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={
                    session.id === state.activeSessionId ? 'session-row is-active' : 'session-row'
                  }
                  aria-current={session.id === state.activeSessionId ? 'page' : undefined}
                  onClick={() => onSelectSession(session.id)}
                  title={session.title}
                >
                  <span className={`session-row__dot status-${session.status}`} />
                  <span className="session-row__copy">
                    <strong>{session.title}</strong>
                    <small>
                      {statusLabel(session.status)} · {timeAgo(session.updatedAt)}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </nav>

      <div className="sidebar__footer">
        <button type="button" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>设置</span>
          <kbd>{shortcutPrefix},</kbd>
        </button>
        <button
          type="button"
          className="sidebar__engine"
          onClick={onOpenSettings}
          aria-label={`Grok Build：${connectionView(state.connectionStatus, state.connectionIssueCode).label}，打开连接中心`}
        >
          <span className={`connection-dot connection-${state.connectionStatus}`} />
          <span>
            Grok {connectionView(state.connectionStatus, state.connectionIssueCode).label}
          </span>
          <Command size={12} />
        </button>
      </div>
    </aside>
  );
}
