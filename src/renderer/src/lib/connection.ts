import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';

export interface ConnectionView {
  label: string;
  title: string;
  summary: string;
  tone: 'neutral' | 'progress' | 'success' | 'warning' | 'error';
}

export function connectionView(
  status: ConnectionStatus,
  issueCode: ConnectionIssueCode | null = null,
): ConnectionView {
  switch (status) {
    case 'checking':
      return {
        label: '正在检测',
        title: '正在检测 Grok Build',
        summary: '正在查找本机 CLI 并读取版本信息。',
        tone: 'progress',
      };
    case 'detected':
      return {
        label: 'CLI 已检测',
        title: '已找到 Grok Build',
        summary: 'CLI 可以运行，正在验证身份并建立 ACP 连接。',
        tone: 'progress',
      };
    case 'connecting':
      return {
        label: '正在连接',
        title: '正在连接 Grok ACP',
        summary: '正在启动本机代理、协商协议并验证已有登录。',
        tone: 'progress',
      };
    case 'ready':
      return {
        label: '已连接',
        title: 'Grok Build 已连接',
        summary: 'ACP 初始化和身份验证均已完成，可以开始任务。',
        tone: 'success',
      };
    case 'offline':
      return {
        label: issueCode === 'binary_missing' ? '未安装' : '已断开',
        title: issueCode === 'binary_missing' ? '没有找到 Grok Build CLI' : 'Grok Build 已断开',
        summary:
          issueCode === 'binary_missing'
            ? '星轨工作台依赖本机 Grok Build CLI，请先安装后重新检测。'
            : '本机代理当前不可用，可以保留草稿并重新连接。',
        tone: 'warning',
      };
    case 'error':
      return {
        label: '连接失败',
        title:
          issueCode === 'authentication_failed'
            ? 'Grok 身份验证失败'
            : issueCode === 'authentication_unsupported'
              ? '身份验证方式暂不兼容'
              : issueCode === 'protocol_incompatible'
                ? 'Grok ACP 版本不兼容'
                : issueCode === 'protocol_invalid'
                  ? 'Grok 返回了不兼容的协议数据'
                  : issueCode === 'version_check_failed'
                    ? '无法读取 Grok CLI 版本'
                    : issueCode === 'timeout'
                      ? '连接 Grok 超时'
                      : issueCode === 'process_failed'
                        ? 'Grok 本机进程意外退出'
                        : '无法连接 Grok Build',
        summary:
          issueCode === 'authentication_failed'
            ? '请先在终端完成 Grok 登录，再返回这里重新连接。'
            : issueCode === 'authentication_unsupported'
              ? '当前 CLI 要求客户端尚未支持的登录方式，请先升级星轨工作台或 Grok Build。'
              : issueCode === 'protocol_incompatible'
                ? '请升级 Grok Build 或安装项目支持的兼容版本。'
                : issueCode === 'protocol_invalid'
                  ? '代理返回了不兼容的协议数据，请检查版本并复制诊断信息。'
                  : issueCode === 'version_check_failed'
                    ? '已找到程序，但执行版本检查失败；请在终端运行 grok --version。'
                    : issueCode === 'process_failed'
                      ? '本机代理意外停止。工作区和未发送草稿仍保留，可以重新连接。'
                      : '连接没有完成。你的工作区和未发送草稿仍保留在本机。',
        tone: 'error',
      };
  }
}

export function cleanDesktopError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  return raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .trim();
}

export function buildConnectionDiagnostic(input: {
  status: ConnectionStatus;
  detail: string;
  issueCode: ConnectionIssueCode | null;
  binaryPath: string | null;
  cliVersion: string | null;
  agentName: string | null;
  agentVersion: string | null;
  appVersion: string;
  platform: string;
  arch: string;
}): string {
  return [
    '星轨工作台连接诊断',
    `应用版本: ${input.appVersion || '未知'}`,
    `平台: ${input.platform || '未知'}/${input.arch || '未知'}`,
    `连接状态: ${input.status}`,
    `问题代码: ${input.issueCode ?? '无'}`,
    `CLI 路径: ${input.binaryPath ?? '未检测到'}`,
    `CLI 版本: ${input.cliVersion ?? '未知'}`,
    `Agent: ${[input.agentName, input.agentVersion].filter(Boolean).join(' ') || '未知'}`,
    `详情: ${input.detail || '无'}`,
  ].join('\n');
}
