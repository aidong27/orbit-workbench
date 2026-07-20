import { ArrowRight, FolderOpen, ListChecks, ShieldCheck, TerminalSquare } from 'lucide-react';
import { OrbitMark } from './OrbitMark';

export function Welcome({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <div className="welcome-scroll">
      <section className="welcome">
        <div className="welcome__mark">
          <OrbitMark size={54} active />
        </div>
        <span className="welcome__eyebrow">GROK BUILD · 中文桌面工作台</span>
        <h1>
          把终端里的 Grok，
          <br />
          带进更清晰的工作流。
        </h1>
        <p>选择一个本地项目，用中文发起任务；计划、工具、变更与权限确认都在同一个界面完成。</p>
        <button type="button" className="welcome__cta" onClick={onOpenWorkspace}>
          <FolderOpen size={17} /> 打开本地工作区 <ArrowRight size={15} />
        </button>
        <div className="welcome__features">
          <div>
            <ListChecks size={16} />
            <span>
              <strong>计划可见</strong>
              <small>步骤和进度集中呈现</small>
            </span>
          </div>
          <div>
            <TerminalSquare size={16} />
            <span>
              <strong>工具可追踪</strong>
              <small>命令与结果按时间展开</small>
            </span>
          </div>
          <div>
            <ShieldCheck size={16} />
            <span>
              <strong>权限可控</strong>
              <small>敏感操作由你决定</small>
            </span>
          </div>
        </div>
        <small className="welcome__disclaimer">
          非官方私人预览 · 调用本机 Grok Build，不存储 API 密钥
        </small>
      </section>
    </div>
  );
}
