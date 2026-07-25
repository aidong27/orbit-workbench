function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const MAX_DIAGNOSTIC_INPUT_CHARACTERS = 65_536;

function replaceControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    result +=
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : character;
  }
  return result;
}

export function sanitizeDiagnostic(value: string, homeDirectory: string): string {
  const boundedValue = value.slice(-MAX_DIAGNOSTIC_INPUT_CHARACTERS);
  const withoutUrlCredentials = boundedValue.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@/\s]+@/giu,
    '$1[凭据已隐藏]@',
  );
  const withoutAuthorization = withoutUrlCredentials.replace(
    /((?:authorization)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:(?:bearer|basic)\s+)?[^\s,;}"']+)/giu,
    '$1[已隐藏]',
  );
  const withoutNamedSecrets = withoutAuthorization.replace(
    /(["']?(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}"']+)/giu,
    '$1[已隐藏]',
  );
  const withoutKnownTokens = withoutNamedSecrets.replace(
    /\b(?:xai-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu,
    '[凭据已隐藏]',
  );
  if (!homeDirectory) return withoutKnownTokens.slice(-4_000);
  return withoutKnownTokens
    .replace(new RegExp(escapeRegExp(homeDirectory), 'giu'), '~')
    .slice(-4_000);
}

export function sanitizeDiagnosticLine(
  value: string,
  homeDirectory: string,
  fallback: string,
  maximumLength = 512,
): string {
  const sanitized = replaceControlCharacters(sanitizeDiagnostic(value, homeDirectory))
    .replace(/\s+/gu, ' ')
    .trim();
  return (sanitized || fallback).slice(0, maximumLength);
}
