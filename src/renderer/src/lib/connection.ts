import type { ConnectionIssueCode, ConnectionStatus } from '../../../shared/types';

export interface ConnectionView {
  label: string;
  title: string;
  summary: string;
  tone: 'neutral' | 'progress' | 'success' | 'warning' | 'error';
}

export const MAX_DIAGNOSTIC_FIELD_LENGTH = 2_000;

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

export function redactDiagnosticText(value: string, platform: string): string {
  if (platform === 'win32') {
    return value.replace(/[a-z]:[\\/]Users[\\/][^\\/\r\n]+/giu, '%USERPROFILE%');
  }
  if (platform === 'darwin') {
    return value.replace(/\/Users\/[^/\r\n]+/gu, '~');
  }
  if (platform === 'linux') {
    return value.replace(/\/home\/[^/\r\n]+/gu, '~');
  }
  return value;
}

export function sanitizeDiagnosticField(value: string, platform: string): string {
  const redactedPaths = redactDiagnosticText(value, platform);
  const redactedUrlCredentials = redactedPaths.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@/\s]+@/giu,
    '$1[凭据已隐藏]@',
  );
  const redactedAuthorization = redactedUrlCredentials.replace(
    /((?:authorization)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:(?:bearer|basic)\s+)?[^\s,;}"']+)/giu,
    '$1[已隐藏]',
  );
  const redactedNamedSecrets = redactedAuthorization.replace(
    /(["']?(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}"']+)/giu,
    '$1[已隐藏]',
  );
  const redacted = redactedNamedSecrets.replace(
    /\b(?:xai-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu,
    '[凭据已隐藏]',
  );
  const compact = Array.from(redacted, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
      ? ' '
      : character;
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  if (compact.length <= MAX_DIAGNOSTIC_FIELD_LENGTH) return compact;
  const suffix = '…[已截断]';
  return `${compact.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH - suffix.length)}${suffix}`;
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
  const clean = (value: string | null, fallback: string): string =>
    value ? sanitizeDiagnosticField(value, input.platform) || fallback : fallback;
  const binaryPath = clean(input.binaryPath, '未检测到');
  const detail = clean(input.detail, '无');
  const cliVersion = clean(input.cliVersion, '未知');
  const agent = [input.agentName, input.agentVersion]
    .filter((value): value is string => Boolean(value))
    .map((value) => sanitizeDiagnosticField(value, input.platform))
    .filter(Boolean)
    .join(' ');
  return [
    '星轨工作台连接诊断',
    `应用版本: ${clean(input.appVersion, '未知')}`,
    `平台: ${clean(input.platform, '未知')}/${clean(input.arch, '未知')}`,
    `连接状态: ${input.status}`,
    `问题代码: ${input.issueCode ?? '无'}`,
    `CLI 路径: ${binaryPath}`,
    `CLI 版本: ${cliVersion}`,
    `Agent: ${agent || '未知'}`,
    `详情: ${detail}`,
  ].join('\n');
}
