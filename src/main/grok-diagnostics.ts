function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function sanitizeDiagnostic(value: string, homeDirectory: string): string {
  const withoutAuthorization = value.replace(
    /((?:authorization)\s*[=:]\s*)(?:(?:bearer|basic)\s+)?[^\s,;}"']+/giu,
    '$1[已隐藏]',
  );
  const withoutNamedSecrets = withoutAuthorization.replace(
    /(["']?(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s,;}"']+/giu,
    '$1[已隐藏]',
  );
  const withoutKnownTokens = withoutNamedSecrets.replace(
    /\b(?:xai-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu,
    '[凭据已隐藏]',
  );
  if (!homeDirectory) return withoutKnownTokens.slice(-4_000);
  return withoutKnownTokens
    .replace(new RegExp(escapeRegExp(homeDirectory), 'gu'), '~')
    .slice(-4_000);
}
