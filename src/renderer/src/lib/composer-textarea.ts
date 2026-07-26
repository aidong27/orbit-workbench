import { type RefObject, useLayoutEffect } from 'react';

export const COMPOSER_TEXTAREA_MIN_HEIGHT = 52;
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 220;

interface ComposerTextareaLayout {
  height: number;
  overflowY: 'auto' | 'hidden';
}

export function composerTextareaLayout(scrollHeight: number): ComposerTextareaLayout {
  const measuredHeight = Number.isFinite(scrollHeight)
    ? Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT, Math.ceil(scrollHeight))
    : COMPOSER_TEXTAREA_MIN_HEIGHT;

  return {
    height: Math.min(measuredHeight, COMPOSER_TEXTAREA_MAX_HEIGHT),
    overflowY: measuredHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden',
  };
}

export function resizeComposerTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`;
  textarea.style.minHeight = `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`;
  textarea.style.maxHeight = `${COMPOSER_TEXTAREA_MAX_HEIGHT}px`;

  const layout = composerTextareaLayout(textarea.scrollHeight);
  textarea.style.height = `${layout.height}px`;
  textarea.style.overflowY = layout.overflowY;
}

export function useAutosizeComposerTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  sessionId: string | undefined,
): void {
  useLayoutEffect(() => {
    void value;
    void sessionId;
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeComposerTextarea(textarea);
  }, [sessionId, textareaRef, value]);

  useLayoutEffect(() => {
    void sessionId;
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === 'undefined') return;
    let measuredWidth = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const width = entries.find((entry) => entry.target === textarea)?.contentRect.width;
      if (width === undefined || width === measuredWidth) return;
      measuredWidth = width;
      resizeComposerTextarea(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [sessionId, textareaRef]);
}
