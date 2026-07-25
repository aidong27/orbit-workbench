interface ShortcutModifierInput {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function hasPrimaryShortcutModifier(input: ShortcutModifierInput): boolean {
  return !input.altKey && (input.metaKey || input.ctrlKey);
}

export function shouldBlockBackgroundShortcut(
  modalOpen: boolean,
  input: ShortcutModifierInput & { key: string },
): boolean {
  if (!modalOpen || !hasPrimaryShortcutModifier(input)) return false;
  const key = input.key.toLowerCase();
  return key === 'k' || key === 'n' || input.key === ',';
}
