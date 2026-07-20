export async function runSessionTaskOnce<T>(
  activeSessionIds: Set<string>,
  sessionId: string,
  task: () => Promise<T>,
): Promise<T | undefined> {
  if (activeSessionIds.has(sessionId)) return undefined;
  activeSessionIds.add(sessionId);
  try {
    return await task();
  } finally {
    activeSessionIds.delete(sessionId);
  }
}
