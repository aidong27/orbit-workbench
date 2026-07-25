export interface WorkAreaSize {
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

const PREFERRED_WIDTH = 1_500;
const PREFERRED_HEIGHT = 960;

function boundedDimension(value: number, preferred: number): number {
  if (!Number.isFinite(value) || value <= 0) return preferred;
  return Math.min(preferred, Math.floor(value));
}

export function windowSizeForWorkArea(
  platform: NodeJS.Platform,
  workArea: WorkAreaSize,
): WindowSize {
  const width = boundedDimension(workArea.width, PREFERRED_WIDTH);
  const height = boundedDimension(workArea.height, PREFERRED_HEIGHT);
  const preferredMinWidth = platform === 'darwin' ? 980 : 760;
  const preferredMinHeight = platform === 'darwin' ? 680 : 560;

  return {
    width,
    height,
    minWidth: Math.min(preferredMinWidth, width),
    minHeight: Math.min(preferredMinHeight, height),
  };
}
