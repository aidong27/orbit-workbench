const ALWAYS_BLOCKED_NAMES = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
]);

const DEFAULT_ALLOWED_NAMES = new Set([
  'OS',
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'XAI_API_KEY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

const PROXY_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']);

// Windows environment names are case-insensitive. Keep the small set required
// to locate the OS, user profile, temporary directories, and installed tools.
const WINDOWS_RUNTIME_NAMES = new Set([
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_ARCHITEW6432',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);

function isDefaultAllowed(name: string, platform: NodeJS.Platform): boolean {
  const normalizedName = name.toUpperCase();
  if (
    DEFAULT_ALLOWED_NAMES.has(platform === 'win32' ? normalizedName : name) ||
    (platform === 'win32' ? normalizedName : name).startsWith('LC_') ||
    (platform === 'win32' ? normalizedName : name).startsWith('GROK_')
  ) {
    return true;
  }
  return PROXY_NAMES.has(normalizedName) || WINDOWS_RUNTIME_NAMES.has(normalizedName);
}

/**
 * Builds the least-privilege environment inherited by the local Grok process.
 * Additional names are opt-in, but cannot restore variables that enable Node
 * or Electron runtime injection.
 */
export function buildGrokChildEnvironment(
  source: Readonly<Record<string, unknown>>,
  extraAllowedNames: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const extraAllowed = new Set(
    extraAllowedNames.map((name) => (platform === 'win32' ? name.toUpperCase() : name)),
  );
  const environment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    const normalizedName = platform === 'win32' ? name.toUpperCase() : name;
    if (ALWAYS_BLOCKED_NAMES.has(name.toUpperCase())) continue;
    if (!isDefaultAllowed(name, platform) && !extraAllowed.has(normalizedName)) continue;
    if (Object.hasOwn(environment, normalizedName)) continue;

    Object.defineProperty(environment, normalizedName, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return environment;
}
