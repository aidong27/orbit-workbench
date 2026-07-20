import type { PermissionResolution } from '../shared/types';

export function requiredString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  if (value.length > maximumLength) throw new Error(`${label}超过允许长度。`);
  if (value.includes('\0')) throw new Error(`${label}包含无效字符。`);
  return value;
}

export function permissionResolution(value: unknown): PermissionResolution {
  if (!value || typeof value !== 'object') throw new Error('权限响应格式无效。');
  const candidate = value as Record<string, unknown>;
  const requestId = requiredString(candidate.requestId, '权限请求 ID', 256);
  const optionId =
    candidate.optionId === undefined
      ? undefined
      : requiredString(candidate.optionId, '权限选项 ID', 256);
  if (candidate.cancelled !== undefined && typeof candidate.cancelled !== 'boolean') {
    throw new Error('权限取消标记格式无效。');
  }
  return { requestId, optionId, cancelled: candidate.cancelled as boolean | undefined };
}
