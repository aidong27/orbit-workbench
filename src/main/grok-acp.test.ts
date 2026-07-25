import { describe, expect, it } from 'vitest';
import { permissionOutcome, sanitizePermissionOptions } from './grok-acp';

describe('Grok ACP 权限响应', () => {
  const options = new Map([
    ['allow-once', 'allow-once'],
    ['reject-once', 'reject-once'],
  ]);

  it('accepts an option from the original request', () => {
    expect(permissionOutcome(options, { requestId: 'request-1', optionId: 'allow-once' })).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('cancels unknown, omitted, and explicitly cancelled options', () => {
    expect(permissionOutcome(options, { requestId: 'request-1', optionId: 'invented' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(permissionOutcome(options, { requestId: 'request-1' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(
      permissionOutcome(options, {
        requestId: 'request-1',
        optionId: 'allow-once',
        cancelled: true,
      }),
    ).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('Grok ACP permission option boundary', () => {
  it('replaces protocol ids, sanitizes labels, and preserves the selected original id only in main', () => {
    const [option] =
      sanitizePermissionOptions([
        {
          optionId: 'allow-original',
          name: 'Allow\u202E password="agent secret"',
          kind: 'allow_once',
        },
      ]) ?? [];

    expect(option).toMatchObject({
      originalOptionId: 'allow-original',
      name: 'Allow password=[已隐藏]',
      kind: 'allow_once',
    });
    expect(option?.safeOptionId).not.toBe('allow-original');
  });

  it('rejects empty, duplicate, oversized, or excessive option sets instead of showing a subset', () => {
    expect(sanitizePermissionOptions([])).toBeNull();
    expect(
      sanitizePermissionOptions([
        { optionId: 'same', name: 'Allow', kind: 'allow_once' },
        { optionId: 'same', name: 'Reject', kind: 'reject_once' },
      ]),
    ).toBeNull();
    expect(
      sanitizePermissionOptions([
        { optionId: 'x'.repeat(4_097), name: 'Allow', kind: 'allow_once' },
      ]),
    ).toBeNull();
    expect(
      sanitizePermissionOptions(
        Array.from({ length: 17 }, (_, index) => ({
          optionId: `option-${index}`,
          name: `Option ${index}`,
          kind: 'reject_once' as const,
        })),
      ),
    ).toBeNull();
    expect(
      sanitizePermissionOptions([
        { optionId: 42, name: null, kind: 'allow_once' },
      ] as unknown as Parameters<typeof sanitizePermissionOptions>[0]),
    ).toBeNull();
  });
});
