import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyFeedbackStatus = 'idle' | 'success' | 'failure';

export function useCopyFeedback(
  resetAfterMs = 1_800,
): readonly [CopyFeedbackStatus, (copied: boolean) => void] {
  const [status, setStatus] = useState<CopyFeedbackStatus>('idle');
  const resetTimerRef = useRef<number | null>(null);

  const report = useCallback(
    (copied: boolean): void => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      setStatus(copied ? 'success' : 'failure');
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setStatus('idle');
      }, resetAfterMs);
    },
    [resetAfterMs],
  );

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  return [status, report] as const;
}
