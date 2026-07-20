export function shouldUseBrowserPreview(
  hasDesktopBridge: boolean,
  isDevelopment: boolean,
  userAgent: string,
): boolean {
  return !hasDesktopBridge && isDevelopment && !userAgent.includes('Electron');
}
