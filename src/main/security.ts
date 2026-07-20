export function contentSecurityPolicy(isPackaged: boolean): string {
  const developmentConnections = isPackaged
    ? ''
    : ' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${developmentConnections}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const CSP_PLACEHOLDER = '__ORBIT_CONTENT_SECURITY_POLICY__';

export function injectContentSecurityPolicy(html: string, isPackaged: boolean): string {
  if (!html.includes(CSP_PLACEHOLDER)) {
    throw new Error('Renderer HTML is missing the CSP placeholder.');
  }
  return html.replace(CSP_PLACEHOLDER, contentSecurityPolicy(isPackaged));
}

type FrameIdentity = { processId: number; routingId: number };

export function isTrustedMainFrame(
  trustedWebContents: boolean,
  senderFrame: FrameIdentity | null,
  mainFrame: FrameIdentity,
): boolean {
  return (
    trustedWebContents &&
    senderFrame !== null &&
    senderFrame.processId === mainFrame.processId &&
    senderFrame.routingId === mainFrame.routingId
  );
}
