import {
  Activity,
  Braces,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileDiff,
  GitBranch,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { compactJson, statusLabel, toolKindLabel } from '../lib/format';
import type {
  InspectorTab,
  PlanItem,
  ToolItem,
  WorkSession,
  WorkspaceProject,
} from '../state/model';

interface InspectorProps {
  project: WorkspaceProject | null;
  session: WorkSession | null;
  appVersion: string;
  activeTab: InspectorTab;
  connectionStatus: string;
  connectionDetail: string;
  onTabChange: (tab: InspectorTab) => void;
  onRefreshProject: () => void;
}

const tabs: { id: InspectorTab; label: string; icon: typeof FileDiff }[] = [
  { id: 'changes', label: '变更', icon: FileDiff },
  { id: 'plan', label: '计划', icon: ListChecks },
  { id: 'tools', label: '工具', icon: TerminalSquare },
  { id: 'context', label: '上下文', icon: Activity },
];

function ChangesPanel({
  project,
  onRefresh,
}: {
  project: WorkspaceProject | null;
  onRefresh: () => void;
}) {
  if (!project) return <InspectorEmpty label="选择工作区后查看文件变更" />;
  return (
    <div className="inspector-panel">
      <div className="inspector-section-heading">
        <span>工作区状态</span>
        {!project.demo && (
          <button type="button" onClick={onRefresh} title="刷新 Git 状态">
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <div className="repo-summary">
        <div>
          <GitBranch size={14} />
          <span>{project.branch ?? '非 Git 工作区'}</span>
        </div>
        <strong>{project.changedFiles}</strong>
        <small>个文件有变更</small>
      </div>
      {project.statusLines.length ? (
        <div className="changed-files">
          {project.statusLines.map((line) => {
            const status = line.slice(0, 2).trim() || 'M';
            const path = line.slice(3) || line;
            return (
              <div key={line} className="changed-file-row">
                <span className={`git-status git-status--${status.charAt(0).toLowerCase()}`}>
                  {status}
                </span>
                <span title={path}>{path}</span>
                <ChevronRight size={12} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="clean-worktree">
          <CheckCircle2 size={15} /> 工作区没有未提交变更
        </div>
      )}
      {project.diffStat && (
        <div className="diff-stat">
          <span>差异统计</span>
          <pre>{project.diffStat}</pre>
        </div>
      )}
    </div>
  );
}

function PlanPanel({ session }: { session: WorkSession | null }) {
  const plan = session?.timeline.findLast((item): item is PlanItem => item.type === 'plan');
  if (!plan) return <InspectorEmpty label="Grok 制定计划后会显示在这里" />;
  return (
    <div className="inspector-panel">
      <div className="inspector-section-heading">
        <span>当前执行计划</span>
        <em>{plan.entries.length} 步</em>
      </div>
      <div className="inspector-plan">
        {plan.entries.map((entry) => (
          <div className={`inspector-plan__entry is-${entry.status}`} key={entry.content}>
            <span>
              {entry.status === 'completed' ? <CheckCircle2 size={14} /> : <Circle size={13} />}
            </span>
            <div>
              <strong>{entry.content}</strong>
              <small>{statusLabel(entry.status)}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolsPanel({ session }: { session: WorkSession | null }) {
  const tools = session?.timeline.filter((item): item is ToolItem => item.type === 'tool') ?? [];
  if (!tools.length) return <InspectorEmpty label="工具调用将在任务运行时出现" />;
  return (
    <div className="inspector-panel">
      <div className="inspector-section-heading">
        <span>工具活动</span>
        <em>{tools.length} 次</em>
      </div>
      <div className="inspector-tools">
        {tools.map((tool) => (
          <div className="inspector-tool" key={tool.id}>
            <span>
              <Wrench size={13} />
            </span>
            <div>
              <strong>{tool.title}</strong>
              <small>
                {toolKindLabel(tool.kind)} · {statusLabel(tool.status)}
              </small>
              {tool.rawInput !== undefined && (
                <code>{compactJson(tool.rawInput).split('\n')[0]}</code>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextPanel({
  session,
  connectionStatus,
  connectionDetail,
}: {
  session: WorkSession | null;
  connectionStatus: string;
  connectionDetail: string;
}) {
  const usage = session?.usage as { used?: number; size?: number; total?: number } | undefined;
  const used = usage?.used ?? usage?.total ?? 0;
  const size = typeof usage?.size === 'number' && usage.size > 0 ? usage.size : null;
  const percent = size ? Math.min(100, Math.round((used / size) * 100)) : 0;
  return (
    <div className="inspector-panel">
      <div className="inspector-section-heading">
        <span>会话上下文</span>
        <em>{size ? `${percent}%` : '—'}</em>
      </div>
      <div className="context-gauge">
        <div className="context-gauge__track">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div>
          <strong>{used ? used.toLocaleString() : '—'}</strong>
          <small>/ {size ? size.toLocaleString() : '—'} tokens</small>
        </div>
      </div>
      <div className="connection-card">
        <div className={`connection-card__icon is-${connectionStatus}`}>
          <Braces size={15} />
        </div>
        <div>
          <strong>ACP 本地桥接</strong>
          <small>{connectionDetail}</small>
        </div>
      </div>
      <div className="security-note">
        <ShieldCheck size={15} />
        <div>
          <strong>密钥不进入界面</strong>
          <p>客户端调用本机官方 grok 进程，并复用其认证与权限策略。</p>
        </div>
      </div>
    </div>
  );
}

function InspectorEmpty({ label }: { label: string }) {
  return (
    <div className="inspector-empty">
      <span>
        <Circle size={18} />
      </span>
      <p>{label}</p>
    </div>
  );
}

export function Inspector({
  project,
  session,
  appVersion,
  activeTab,
  connectionStatus,
  connectionDetail,
  onTabChange,
  onRefreshProject,
}: InspectorProps) {
  return (
    <aside className="inspector">
      <div className="inspector__tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              className={tab.id === activeTab ? 'is-active' : ''}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className="inspector__body">
        {activeTab === 'changes' && <ChangesPanel project={project} onRefresh={onRefreshProject} />}
        {activeTab === 'plan' && <PlanPanel session={session} />}
        {activeTab === 'tools' && <ToolsPanel session={session} />}
        {activeTab === 'context' && (
          <ContextPanel
            session={session}
            connectionStatus={connectionStatus}
            connectionDetail={connectionDetail}
          />
        )}
      </div>
      <div className="inspector__footer">
        <span>
          <ShieldCheck size={12} /> 本地优先
        </span>
        <span>v{appVersion} 预览</span>
      </div>
    </aside>
  );
}
