import type { UiPlanEntry } from '../../../shared/types';
import type { PlanEntry } from './model';

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function reconcilePlanEntries(planId: string | null, entries: UiPlanEntry[]): PlanEntry[] {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const occurrence = occurrences.get(entry.content) ?? 0;
    occurrences.set(entry.content, occurrence + 1);
    return {
      ...entry,
      id: `plan-entry-${hashText(`${JSON.stringify(planId)}\0${entry.content}`)}-${occurrence}`,
    };
  });
}
