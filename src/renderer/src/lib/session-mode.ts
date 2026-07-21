import type { SessionModeOption } from '../../../shared/types';

export type InitialModeDecision = {
  desiredModeId: string | null;
  shouldSwitch: boolean;
  unsupported: boolean;
};

export function decideInitialMode(
  requestedModeId: string | null,
  currentModeId: string | null,
  availableModes: readonly SessionModeOption[],
): InitialModeDecision {
  const desiredModeId = requestedModeId ?? currentModeId;
  const differs = Boolean(desiredModeId && desiredModeId !== currentModeId);
  return {
    desiredModeId,
    shouldSwitch: differs && availableModes.some((mode) => mode.id === desiredModeId),
    unsupported:
      differs &&
      availableModes.length > 0 &&
      !availableModes.some((mode) => mode.id === desiredModeId),
  };
}
