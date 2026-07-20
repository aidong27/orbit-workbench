import { describe, expect, it } from 'vitest';
import { permissionResolution, requiredString } from './ipc-validation';

describe('IPC 参数校验', () => {
  it('rejects empty, oversized, and null-byte strings', () => {
    expect(() => requiredString('', '会话 ID', 10)).toThrow('不能为空');
    expect(() => requiredString('12345678901', '会话 ID', 10)).toThrow('超过允许长度');
    expect(() => requiredString('bad\0id', '会话 ID', 10)).toThrow('无效字符');
  });

  it('normalizes a valid permission response', () => {
    expect(
      permissionResolution({ requestId: 'request-1', optionId: 'allow-once', cancelled: false }),
    ).toEqual({ requestId: 'request-1', optionId: 'allow-once', cancelled: false });
  });

  it('rejects malformed permission responses', () => {
    expect(() => permissionResolution({ requestId: 'request-1', cancelled: 'yes' })).toThrow(
      '格式无效',
    );
  });
});
