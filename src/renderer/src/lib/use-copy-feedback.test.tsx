// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCopyFeedback } from './use-copy-feedback';

describe('useCopyFeedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets feedback and clears a pending timeout when unmounted', () => {
    vi.useFakeTimers();
    const view = renderHook(() => useCopyFeedback(1_800));

    act(() => view.result.current[1](true));
    expect(view.result.current[0]).toBe('success');
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(1_800));
    expect(view.result.current[0]).toBe('idle');

    act(() => view.result.current[1](false));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
