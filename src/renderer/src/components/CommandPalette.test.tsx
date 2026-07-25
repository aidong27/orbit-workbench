// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  afterEach(cleanup);

  it('uses arrow keys to choose a command before Enter', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNewSession = vi.fn();
    const onOpenWorkspace = vi.fn();
    render(
      <CommandPalette
        open
        platform="darwin"
        onClose={onClose}
        onNewSession={onNewSession}
        onOpenWorkspace={onOpenWorkspace}
        onToggleSidebar={vi.fn()}
        onToggleInspector={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    expect(onNewSession).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
