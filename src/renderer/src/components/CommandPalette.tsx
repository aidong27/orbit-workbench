import { FolderOpen, PanelRight, Plus, Search, Settings, SidebarClose } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  platform: string;
  onClose: () => void;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  open,
  platform,
  onClose,
  onNewSession,
  onOpenWorkspace,
  onToggleSidebar,
  onToggleInspector,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutPrefix = platform === 'darwin' ? '⌘' : 'Ctrl+';
  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'new',
        label: '新建任务',
        hint: `${shortcutPrefix}N`,
        icon: Plus,
        run: onNewSession,
      },
      {
        id: 'workspace',
        label: '打开本地工作区',
        hint: '文件夹',
        icon: FolderOpen,
        run: onOpenWorkspace,
      },
      {
        id: 'sidebar',
        label: '切换左侧边栏',
        hint: '布局',
        icon: SidebarClose,
        run: onToggleSidebar,
      },
      {
        id: 'inspector',
        label: '切换右侧检查器',
        hint: '布局',
        icon: PanelRight,
        run: onToggleInspector,
      },
      {
        id: 'settings',
        label: '打开连接中心与设置',
        hint: `${shortcutPrefix},`,
        icon: Settings,
        run: onOpenSettings,
      },
    ],
    [
      onNewSession,
      onOpenWorkspace,
      onToggleSidebar,
      onToggleInspector,
      onOpenSettings,
      shortcutPrefix,
    ],
  );
  const filtered = commands.filter((command) => command.label.includes(query.trim()));

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;
  const run = (command: CommandItem): void => {
    onClose();
    command.run();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the visual backdrop dismisses the modal.
    <div className="command-backdrop" onMouseDown={onClose} role="presentation">
      <section
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
      >
        <h2 id="command-palette-title" className="visually-hidden">
          命令
        </h2>
        <div className="command-palette__input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Home') {
                event.preventDefault();
                setSelectedIndex(0);
              }
              if (event.key === 'End') {
                event.preventDefault();
                setSelectedIndex(Math.max(filtered.length - 1, 0));
              }
              if (event.key === 'Enter' && filtered[selectedIndex]) {
                run(filtered[selectedIndex]);
              }
            }}
            placeholder="搜索命令…"
            role="combobox"
            aria-controls="command-results"
            aria-expanded="true"
            aria-activedescendant={
              filtered[selectedIndex] ? `command-${filtered[selectedIndex].id}` : undefined
            }
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette__group" id="command-results" role="listbox">
          <span>常用命令</span>
          {filtered.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                type="button"
                key={command.id}
                id={`command-${command.id}`}
                className={index === selectedIndex ? 'is-active' : ''}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => run(command)}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <span className="command-palette__icon">
                  <Icon size={15} />
                </span>
                <strong>{command.label}</strong>
                <small>{command.hint}</small>
              </button>
            );
          })}
          {filtered.length === 0 && <p>没有匹配的命令</p>}
        </div>
      </section>
    </div>
  );
}
