import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FilePenLine,
  Search,
  Sparkles,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isAllowedExternalUrl } from '../../../shared/url';
import { compactJson, statusLabel, toolKindLabel } from '../lib/format';
import type {
  MessageItem,
  PlanItem,
  ThoughtItem,
  TimelineItem as TimelineItemType,
  ToolItem,
  WorkSession,
} from '../state/model';
import { OrbitMark } from './OrbitMark';

function ToolIcon({ kind }: { kind: string }) {
  if (kind === 'search' || kind === 'read') return <Search size={14} />;
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return <FilePenLine size={14} />;
  if (kind === 'execute') return <TerminalSquare size={14} />;
  return <Wrench size={14} />;
}

function MessageCard({ item }: { item: MessageItem }) {
  if (item.role === 'user') {
    return (
      <article className="timeline-message timeline-message--user">
        <div className="timeline-message__label">你</div>
        <div className="user-prompt">{item.content}</div>
      </article>
    );
  }
  if (item.role === 'system') {
    return (
      <article className={item.error ? 'system-message system-message--error' : 'system-message'}>
        {item.error ? <XCircle size={14} /> : <Circle size={10} />}
        <span>{item.content}</span>
      </article>
    );
  }
  return (
    <article className="timeline-message timeline-message--assistant">
      <div className="assistant-avatar">
        <OrbitMark size={24} active={item.streaming} />
      </div>
      <div className="assistant-body markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) =>
              href && isAllowedExternalUrl(href) ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ) : (
                <span>{children}</span>
              ),
          }}
        >
          {item.content}
        </ReactMarkdown>
        {item.streaming && <span className="stream-caret" />}
      </div>
    </article>
  );
}

function ThoughtCard({ item }: { item: ThoughtItem }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="thought-card">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        <Sparkles size={13} />
        <span>过程摘要</span>
        {item.streaming && (
          <span className="thinking-dots">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="thought-card__spacer" />
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <p>{item.content}</p>}
    </article>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const rawInput = compactJson(item.rawInput);
  const rawOutput = compactJson(item.rawOutput ?? item.content);
  const expandable = Boolean(rawInput || rawOutput);
  return (
    <article className={`tool-card tool-card--${item.status}`}>
      <button
        type="button"
        className="tool-card__header"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="tool-card__icon">
          <ToolIcon kind={item.kind} />
        </span>
        <span className="tool-card__copy">
          <strong>{item.title}</strong>
          <small>{toolKindLabel(item.kind)}</small>
        </span>
        <span className={`tool-status tool-status--${item.status}`}>
          {item.status === 'completed' ? (
            <Check size={11} />
          ) : (
            <span className="tool-status__spinner" />
          )}
          {statusLabel(item.status)}
        </span>
        {expandable && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </button>
      {open && (
        <div className="tool-card__details">
          {rawInput && (
            <div>
              <span>输入</span>
              <pre>{rawInput}</pre>
            </div>
          )}
          {rawOutput && (
            <div>
              <span>输出</span>
              <pre>{rawOutput}</pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PlanCard({ item }: { item: PlanItem }) {
  const completed = item.entries.filter((entry) => entry.status === 'completed').length;
  return (
    <article className="plan-card">
      <div className="plan-card__header">
        <span className="plan-card__diamond">◆</span>
        <strong>执行计划</strong>
        <span>
          {completed}/{item.entries.length}
        </span>
      </div>
      <ol>
        {item.entries.map((entry) => (
          <li key={entry.content} className={`plan-entry plan-entry--${entry.status}`}>
            <span className="plan-entry__state">
              {entry.status === 'completed' ? (
                <CheckCircle2 size={14} />
              ) : entry.status === 'in_progress' ? (
                <Clock3 size={14} />
              ) : (
                <Circle size={13} />
              )}
            </span>
            <span>{entry.content}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function TimelineEntry({ item }: { item: TimelineItemType }) {
  switch (item.type) {
    case 'message':
      return <MessageCard item={item} />;
    case 'thought':
      return <ThoughtCard item={item} />;
    case 'tool':
      return <ToolCard item={item} />;
    case 'plan':
      return <PlanCard item={item} />;
    case 'status':
      return (
        <div className={`turn-status turn-status--${item.tone}`}>
          <span />
          {item.tone === 'success' ? <CheckCircle2 size={13} /> : <Circle size={10} />}
          <em>{item.label}</em>
          <span />
        </div>
      );
  }
}

export function Timeline({ session }: { session: WorkSession }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineLength = session.timeline.length;

  useEffect(() => {
    if (timelineLength === 0 && session.status === 'idle') return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [timelineLength, session.status]);

  return (
    <div className="conversation-scroll" ref={scrollRef}>
      <div className="conversation-canvas">
        {session.demo && (
          <div className="preview-notice">
            <Bot size={14} />
            <span>这是功能界面预览。打开真实工作区后，会连接本机 Grok Build。</span>
          </div>
        )}
        {session.timeline.map((item) => (
          <TimelineEntry key={item.id} item={item} />
        ))}
        {session.status === 'connecting' && (
          <div className="connecting-row">
            <OrbitMark size={22} active />
            <span>正在创建 Grok ACP 会话…</span>
          </div>
        )}
      </div>
    </div>
  );
}
