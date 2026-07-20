import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CSP_PLACEHOLDER,
  contentSecurityPolicy,
  injectContentSecurityPolicy,
  isTrustedMainFrame,
} from './security';

describe('Electron CSP', () => {
  it('does not allow localhost connections in packaged builds', () => {
    const policy = contentSecurityPolicy(true);
    expect(policy).not.toContain('localhost');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('allows only local Vite endpoints during development', () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain('http://localhost:*');
    expect(policy).toContain('ws://127.0.0.1:*');
  });

  it('injects a strict policy into the packaged file renderer HTML', () => {
    const htmlPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
    const source = readFileSync(htmlPath, 'utf8');
    expect(source).toContain('http-equiv="Content-Security-Policy"');
    expect(source).toContain(CSP_PLACEHOLDER);

    const packagedHtml = injectContentSecurityPolicy(source, true);
    expect(packagedHtml).not.toContain(CSP_PLACEHOLDER);
    expect(packagedHtml).not.toContain('localhost');
    expect(packagedHtml).toContain("default-src 'self'");
  });

  it('accepts distinct WebFrameMain wrappers only when their stable ids match', () => {
    const sender = { processId: 17, routingId: 42 };
    const main = { processId: 17, routingId: 42 };
    expect(sender).not.toBe(main);
    expect(isTrustedMainFrame(true, sender, main)).toBe(true);
    expect(isTrustedMainFrame(true, { ...sender, routingId: 43 }, main)).toBe(false);
    expect(isTrustedMainFrame(false, sender, main)).toBe(false);
    expect(isTrustedMainFrame(true, null, main)).toBe(false);
  });
});
