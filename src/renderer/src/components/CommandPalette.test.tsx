// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('does not run a command while an IME candidate is being confirmed', () => {
    const onNewSession = vi.fn();
    render(
      <CommandPalette
        open
        platform="win32"
        onClose={vi.fn()}
        onNewSession={onNewSession}
        onOpenWorkspace={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleInspector={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('combobox'), {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
    });
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it('traps keyboard focus and restores it after closing', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const props = {
      platform: 'win32',
      onClose: vi.fn(),
      onNewSession: vi.fn(),
      onOpenWorkspace: vi.fn(),
      onToggleSidebar: vi.fn(),
      onToggleInspector: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const view = render(<CommandPalette open {...props} />);
    const input = screen.getByRole('combobox');
    const lastCommand = screen.getByRole('option', {
      name: /打开连接中心与设置/,
    });
    lastCommand.focus();

    fireEvent.keyDown(lastCommand, { key: 'Tab' });
    expect(input).toHaveFocus();

    view.rerender(<CommandPalette open={false} {...props} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
