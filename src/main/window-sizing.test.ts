import { describe, expect, it } from 'vitest';
import { windowSizeForWorkArea } from './window-sizing';

describe('desktop window sizing', () => {
  it('fits the initial Windows window inside a 1366x768 display at 125% scaling', () => {
    expect(windowSizeForWorkArea('win32', { width: 1_093, height: 576 })).toEqual({
      width: 1_093,
      height: 576,
      minWidth: 760,
      minHeight: 560,
    });
  });

  it('keeps the preferred Windows size on a large display', () => {
    expect(windowSizeForWorkArea('win32', { width: 2_560, height: 1_440 })).toEqual({
      width: 1_500,
      height: 960,
      minWidth: 760,
      minHeight: 560,
    });
  });

  it('does not set minimum dimensions larger than a constrained work area', () => {
    expect(windowSizeForWorkArea('win32', { width: 720, height: 500 })).toEqual({
      width: 720,
      height: 500,
      minWidth: 720,
      minHeight: 500,
    });
  });

  it('preserves the existing macOS minimum dimensions', () => {
    expect(windowSizeForWorkArea('darwin', { width: 1_800, height: 1_000 })).toEqual({
      width: 1_500,
      height: 960,
      minWidth: 980,
      minHeight: 680,
    });
  });
});
