import { describe, expect, it } from 'vitest';
import {
  buildConnectionDiagnostic,
  MAX_DIAGNOSTIC_FIELD_LENGTH,
  redactDiagnosticText,
  sanitizeDiagnosticField,
} from './connection';

describe('connection diagnostic redaction', () => {
  it('replaces Windows user profiles in both paths and details', () => {
    const diagnostic = buildConnectionDiagnostic({
      status: 'error',
      detail: String.raw`无法读取 C:\Users\李雷\.grok\auth.json`,
      issueCode: 'process_failed',
      binaryPath: String.raw`C:\Users\李雷\.grok\bin\grok.exe`,
      cliVersion: null,
      agentName: null,
      agentVersion: null,
      appVersion: '0.2.0-alpha.4',
      platform: 'win32',
      arch: 'x64',
    });

    expect(diagnostic).toContain(String.raw`CLI 路径: %USERPROFILE%\.grok\bin\grok.exe`);
    expect(diagnostic).toContain(String.raw`详情: 无法读取 %USERPROFILE%\.grok\auth.json`);
    expect(diagnostic).not.toContain('李雷');
  });

  it('redacts and bounds every external diagnostic field', () => {
    const userPath = String.raw`C:\Users\李雷\私有目录`;
    const diagnostic = buildConnectionDiagnostic({
      status: 'error',
      detail: `连接失败\n${userPath}\\detail.log`,
      issueCode: 'process_failed',
      binaryPath: `${userPath}\\grok.exe`,
      cliVersion: `grok from ${userPath}\\version.txt`,
      agentName: `Agent ${userPath}\\agent`,
      agentVersion: `version ${userPath}\\agent-version`,
      appVersion: '0.2.0-alpha.4',
      platform: 'win32',
      arch: 'x64',
    });

    expect(diagnostic).not.toContain('李雷');
    expect(diagnostic).not.toContain('\nC:');
    expect(diagnostic).toContain(
      String.raw`CLI 版本: grok from %USERPROFILE%\私有目录\version.txt`,
    );
    expect(diagnostic).toContain(String.raw`Agent: Agent %USERPROFILE%\私有目录\agent`);
    expect(diagnostic).toContain(String.raw`version %USERPROFILE%\私有目录\agent-version`);
  });

  it('truncates oversized fields without exceeding the field limit', () => {
    const sanitized = sanitizeDiagnosticField('x'.repeat(5_000), 'win32');

    expect(sanitized).toHaveLength(MAX_DIAGNOSTIC_FIELD_LENGTH);
    expect(sanitized.endsWith('…[已截断]')).toBe(true);
  });

  it('redacts credentials in every copied diagnostic field', () => {
    const diagnostic = buildConnectionDiagnostic({
      status: 'error',
      detail: 'Authorization: Bearer bearer-secret',
      issueCode: 'process_failed',
      binaryPath: String.raw`C:\Tools\xai-abcdefghijk\grok.exe`,
      cliVersion: 'token=version-secret',
      agentName: 'https://alice:password@example.test',
      agentVersion: 'sk-abcdefghijk',
      appVersion: '0.2.0-alpha.4',
      platform: 'win32',
      arch: 'x64',
    });

    for (const secret of [
      'bearer-secret',
      'xai-abcdefghijk',
      'version-secret',
      'alice',
      'password@example',
      'sk-abcdefghijk',
    ]) {
      expect(diagnostic).not.toContain(secret);
    }
  });

  it('never includes an account email in copied diagnostics', () => {
    const diagnostic = buildConnectionDiagnostic({
      status: 'offline',
      detail: '已退出 Grok 登录（developer@example.test），并确认本地代理已经停止。',
      issueCode: 'authentication_required',
      binaryPath: '/Users/developer/.grok/bin/grok',
      cliVersion: 'grok 0.2.112 for developer@example.test',
      agentName: null,
      agentVersion: null,
      appVersion: '0.2.0-alpha.5',
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(diagnostic).not.toContain('developer@example.test');
    expect(diagnostic).toContain('[邮箱已隐藏]');
  });

  it('redacts quoted secrets with spaces and strips bidi formatting from copied diagnostics', () => {
    const diagnostic = sanitizeDiagnosticField(
      'password="two words secret" Authorization: "Bearer another secret" safe\u202Etxt',
      'win32',
    );

    expect(diagnostic).not.toContain('two words secret');
    expect(diagnostic).not.toContain('another secret');
    expect(diagnostic).not.toContain('\u202E');
    expect(diagnostic).toBe('password=[已隐藏] Authorization: [已隐藏] safe txt');
  });

  it('replaces macOS and Linux home directories without altering the original UI value', () => {
    const macPath = '/Users/alice/.grok/bin/grok';
    const linuxPath = '/home/bob/.local/bin/grok';

    expect(redactDiagnosticText(macPath, 'darwin')).toBe('~/.grok/bin/grok');
    expect(redactDiagnosticText(linuxPath, 'linux')).toBe('~/.local/bin/grok');
    expect(macPath).toBe('/Users/alice/.grok/bin/grok');
  });
});
