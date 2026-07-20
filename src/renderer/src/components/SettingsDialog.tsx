import { CheckCircle2, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { OrbitMark } from './OrbitMark';

interface SettingsDialogProps {
  open: boolean;
  version: string;
  platform: string;
  arch: string;
  connectionStatus: string;
  connectionDetail: string;
  onClose: () => void;
}

export function SettingsDialog({
  open,
  version,
  platform,
  arch,
  connectionStatus,
  connectionDetail,
  onClose,
}: SettingsDialogProps) {
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the visual backdrop dismisses the modal.
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        className="settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <OrbitMark size={28} active={connectionStatus === 'ready'} />
            <span>
              <strong>设置与关于</strong>
              <small>
                星轨工作台 {version} · {platform}/{arch}
              </small>
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="settings-dialog__content">
          <section>
            <h3>本机引擎</h3>
            <div className="setting-row">
              <span className={`setting-row__status is-${connectionStatus}`}>
                <CheckCircle2 size={15} />
              </span>
              <div>
                <strong>Grok Build ACP</strong>
                <small>{connectionDetail}</small>
              </div>
              <em>{connectionStatus === 'ready' ? '已连接' : '未连接'}</em>
            </div>
          </section>
          <section>
            <h3>权限与隐私</h3>
            <div className="setting-row setting-row--stacked">
              <ShieldCheck size={16} />
              <div>
                <strong>密钥留在本机 Grok Build</strong>
                <small>界面不读取或存储认证文件。敏感工具调用会通过 ACP 显示确认选项。</small>
              </div>
            </div>
          </section>
          <section>
            <h3>关于这个预览</h3>
            <p className="about-copy">
              星轨工作台是独立开发的非官方中文图形客户端，通过官方 Grok Build CLI 的 ACP
              接口工作，与 xAI 无隶属或背书关系。
            </p>
            <div className="about-links">
              <a href="https://docs.x.ai/build/overview" target="_blank" rel="noreferrer">
                Grok Build 文档 <ExternalLink size={12} />
              </a>
              <a href="https://github.com/xai-org/grok-build" target="_blank" rel="noreferrer">
                官方开源仓库 <ExternalLink size={12} />
              </a>
            </div>
          </section>
        </div>
        <footer>
          <span>开源预览 · Apache-2.0</span>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
