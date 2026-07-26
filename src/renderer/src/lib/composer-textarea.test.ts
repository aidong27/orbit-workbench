import { describe, expect, it } from 'vitest';
import {
  COMPOSER_TEXTAREA_MAX_HEIGHT,
  COMPOSER_TEXTAREA_MIN_HEIGHT,
  composerTextareaLayout,
} from './composer-textarea';

describe('composerTextareaLayout', () => {
  it('keeps a one-line draft at the minimum height without a scrollbar', () => {
    expect(composerTextareaLayout(24)).toEqual({
      height: COMPOSER_TEXTAREA_MIN_HEIGHT,
      overflowY: 'hidden',
    });
  });

  it('grows a multi-line draft to its measured height', () => {
    expect(composerTextareaLayout(144)).toEqual({
      height: 144,
      overflowY: 'hidden',
    });
  });

  it('caps long drafts and enables internal scrolling', () => {
    expect(composerTextareaLayout(480)).toEqual({
      height: COMPOSER_TEXTAREA_MAX_HEIGHT,
      overflowY: 'auto',
    });
  });
});
