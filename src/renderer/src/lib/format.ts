export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function modeLabel(modeId: string | null): string {
  const labels: Record<string, string> = {
    normal: '普通',
    default: '普通',
    plan: '计划',
    'always-approve': '始终批准',
    always_approve: '始终批准',
  };
  return modeId ? (labels[modeId] ?? modeId) : '普通';
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    idle: '空闲',
    connecting: '连接中',
    working: '进行中',
    awaiting_permission: '待你确认',
    completed: '已完成',
    cancelled: '已停止',
    failed: '失败',
    pending: '待处理',
    in_progress: '执行中',
  };
  return labels[status] ?? status;
}

export function toolKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    read: '读取',
    edit: '编辑',
    delete: '删除',
    move: '移动',
    search: '搜索',
    execute: '终端',
    think: '分析',
    fetch: '获取',
    switch_mode: '模式',
    other: '工具',
  };
  return labels[kind] ?? kind;
}

export function compactJson(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
