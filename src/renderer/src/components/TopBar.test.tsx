// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('keeps the visible engine state aligned with the connection issue', () => {
    render(
      <TopBar
        project={null}
        session={null}
        inspectorOpen={false}
        connectionStatus="offline"
        connectionIssueCode="binary_missing"
        onOpenConnectionCenter={vi.fn()}
        onToggleInspector={vi.fn()}
        onRefreshProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Grok Build：未安装/ })).toHaveTextContent(
      'Grok 未安装',
    );
  });
});
