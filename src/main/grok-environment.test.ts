import { describe, expect, it } from 'vitest';
import { buildGrokChildEnvironment } from './grok-environment';

describe('Grok child environment', () => {
  it('does not inherit unrelated development and service secrets', () => {
    const environment = buildGrokChildEnvironment({
      PATH: '/usr/bin:/bin',
      AWS_ACCESS_KEY_ID: 'aws-access-key',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-key',
      DATABASE_URL: 'postgres://secret',
      DB_PASSWORD: 'database-password',
      GITHUB_TOKEN: 'github-token',
      NPM_TOKEN: 'npm-token',
    });

    expect(environment).toEqual({ PATH: '/usr/bin:/bin' });
  });

  it('keeps the portable runtime, Grok, locale, certificate, and Windows variables', () => {
    const environment = buildGrokChildEnvironment(
      {
        OS: 'Windows_NT',
        PATH: '/usr/bin:/bin',
        HOME: '/Users/alice',
        USERPROFILE: 'C:\\Users\\Alice',
        TMP: '/tmp',
        TEMP: 'C:\\Temp',
        TMPDIR: '/private/tmp',
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8',
        LC_MESSAGES: 'zh_CN.UTF-8',
        GROK_BINARY: '/opt/grok/bin/grok',
        GROK_SANDBOX: 'strict',
        XAI_API_KEY: 'xai-key',
        SSL_CERT_FILE: '/etc/ssl/cert.pem',
        SSL_CERT_DIR: '/etc/ssl/certs',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/company.pem',
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
      },
      [],
      'linux',
    );

    expect(environment).toEqual({
      OS: 'Windows_NT',
      PATH: '/usr/bin:/bin',
      HOME: '/Users/alice',
      USERPROFILE: 'C:\\Users\\Alice',
      TMP: '/tmp',
      TEMP: 'C:\\Temp',
      TMPDIR: '/private/tmp',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      LC_MESSAGES: 'zh_CN.UTF-8',
      GROK_BINARY: '/opt/grok/bin/grok',
      GROK_SANDBOX: 'strict',
      XAI_API_KEY: 'xai-key',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      SSL_CERT_DIR: '/etc/ssl/certs',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/company.pem',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
    });
  });

  it('accepts common proxy variables in upper, lower, and mixed case', () => {
    const environment = buildGrokChildEnvironment(
      {
        HTTP_PROXY: 'http://upper-http',
        http_proxy: 'http://lower-http',
        Https_Proxy: 'http://mixed-https',
        https_proxy: 'http://lower-https',
        ALL_PROXY: 'socks5://upper-all',
        all_proxy: 'socks5://lower-all',
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: '.internal.example',
      },
      [],
      'linux',
    );

    expect(environment).toEqual({
      HTTP_PROXY: 'http://upper-http',
      http_proxy: 'http://lower-http',
      Https_Proxy: 'http://mixed-https',
      https_proxy: 'http://lower-https',
      ALL_PROXY: 'socks5://upper-all',
      all_proxy: 'socks5://lower-all',
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: '.internal.example',
    });
  });

  it('canonicalizes proxy aliases on Windows and keeps the first value', () => {
    const environment = buildGrokChildEnvironment(
      {
        HTTP_PROXY: 'http://upper-http',
        http_proxy: 'http://shadow-http',
        Https_Proxy: 'http://mixed-https',
        https_proxy: 'http://shadow-https',
        ALL_PROXY: 'socks5://upper-all',
        all_proxy: 'socks5://shadow-all',
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: '.shadow.example',
      },
      [],
      'win32',
    );

    expect(environment).toEqual({
      HTTP_PROXY: 'http://upper-http',
      HTTPS_PROXY: 'http://mixed-https',
      ALL_PROXY: 'socks5://upper-all',
      NO_PROXY: 'localhost,127.0.0.1',
    });
  });

  it('canonicalizes case-insensitive Windows names and blocks duplicate aliases', () => {
    const environment = buildGrokChildEnvironment(
      {
        Path: 'C:\\Windows\\System32',
        PATH: 'C:\\attacker-shadow',
        comspec: 'C:\\Windows\\System32\\cmd.exe',
        grok_home: 'C:\\Users\\爱丽丝\\.grok',
        xai_api_key: 'xai-key',
        node_options: '--require C:\\inject.cjs',
      },
      [],
      'win32',
    );

    expect(environment).toEqual({
      PATH: 'C:\\Windows\\System32',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      GROK_HOME: 'C:\\Users\\爱丽丝\\.grok',
      XAI_API_KEY: 'xai-key',
    });
  });

  it('allows explicitly selected variables without opening the rest of the environment', () => {
    const environment = buildGrokChildEnvironment(
      {
        AWS_PROFILE: 'development',
        GH_TOKEN: 'explicit-token',
        GITHUB_TOKEN: 'not-selected',
      },
      ['AWS_PROFILE', 'GH_TOKEN'],
    );

    expect(environment).toEqual({
      AWS_PROFILE: 'development',
      GH_TOKEN: 'explicit-token',
    });
  });

  it('never restores Node or Electron injection variables through the extra allowlist', () => {
    const environment = buildGrokChildEnvironment(
      {
        NODE_OPTIONS: '--require ./inject.cjs',
        node_path: '/tmp/injected-modules',
        ELECTRON_RUN_AS_NODE: '1',
        electron_renderer_url: 'https://attacker.invalid',
        SAFE_EXTRA: 'kept',
      },
      ['NODE_OPTIONS', 'node_path', 'ELECTRON_RUN_AS_NODE', 'electron_renderer_url', 'SAFE_EXTRA'],
    );

    expect(environment).toEqual({ SAFE_EXTRA: 'kept' });
  });

  it('ignores non-string values even when their names are allowed', () => {
    const environment = buildGrokChildEnvironment(
      {
        PATH: '/usr/bin',
        HOME: undefined,
        EXTRA_NUMBER: 42,
        EXTRA_BOOLEAN: true,
        EXTRA_NULL: null,
      },
      ['EXTRA_NUMBER', 'EXTRA_BOOLEAN', 'EXTRA_NULL'],
    );

    expect(environment).toEqual({ PATH: '/usr/bin' });
  });
});
