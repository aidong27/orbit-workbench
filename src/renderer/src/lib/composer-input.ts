interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export function shouldSubmitComposerKey(input: ComposerKeyInput): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing && input.keyCode !== 229;
}
