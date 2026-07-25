import { createHash } from 'node:crypto';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  SafeDisplayValue,
  SanitizedToolCall,
  UiAcpEvent,
  UiAvailableCommand,
  UiPlanEntry,
  UiSessionConfigOption,
  UiSessionConfigSelectGroup,
  UiSessionConfigSelectOption,
  UiTurnUsage,
} from '../shared/types';

export const ACP_DISPLAY_LIMITS = {
  maxDepth: 6,
  maxObjectKeys: 64,
  maxArrayItems: 64,
  maxStringCharacters: 16_000,
  maxSerializedCharacters: 50_000,
  maxIdentifierCharacters: 1_024,
  maxCollectionCharacters: 40_000,
  maxPlanEntryCharacters: 1_000,
  maxLabelCharacters: 512,
  maxMarkdownCharacters: 32_000,
  maxUriCharacters: 4_096,
} as const;

const DEPTH_TRUNCATION = '[内容嵌套过深，已截断]';
const CIRCULAR_TRUNCATION = '[检测到循环引用，已截断]';
const SIZE_TRUNCATION = '[内容超过安全显示上限，已截断]';

type DisplayBudget = {
  remainingNodes: number;
  remainingCharacters: number;
};

export type CollectionResult<T> = {
  items: T[];
  truncated: boolean;
};

function truncatedText(value: string, maximum: number): { value: string; truncated: boolean } {
  if (value.length <= maximum) return { value, truncated: false };
  const suffix = `…（已截断 ${value.length - maximum} 字符）`;
  const prefixLength = Math.max(0, maximum - suffix.length);
  return { value: `${value.slice(0, prefixLength)}${suffix}`, truncated: true };
}

export function sanitizeProtocolIdentifier(value: string): string {
  if (value.length <= ACP_DISPLAY_LIMITS.maxIdentifierCharacters) return value;
  const maximum = ACP_DISPLAY_LIMITS.maxIdentifierCharacters;
  const digest = createHash('sha256').update(value).digest('hex');
  const marker = `…[${value.length}:${digest}]…`;
  const available = maximum - marker.length;
  const prefixLength = Math.ceil(available / 2);
  const suffixLength = Math.floor(available / 2);
  return `${value.slice(0, prefixLength)}${marker}${value.slice(-suffixLength)}`;
}

function uniqueObjectKey(target: Record<string, SafeDisplayValue>, requested: string): string {
  if (!(requested in target)) return requested;
  let suffix = 2;
  while (`${requested}#${suffix}` in target) suffix += 1;
  return `${requested}#${suffix}`;
}

function sanitizeDisplayNode(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: DisplayBudget,
): SafeDisplayValue {
  if (budget.remainingNodes <= 0 || budget.remainingCharacters <= 0) return SIZE_TRUNCATION;
  budget.remainingNodes -= 1;
  if (value === null) return null;
  if (typeof value === 'string') {
    const maximum = Math.min(ACP_DISPLAY_LIMITS.maxStringCharacters, budget.remainingCharacters);
    const result = truncatedText(value, maximum).value;
    budget.remainingCharacters -= result.length;
    return result;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : `[无效数字：${value}]`;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return '[未提供]';
  if (typeof value === 'symbol') return `[无法显示的 symbol：${value.description ?? ''}]`;
  if (typeof value === 'function') return '[无法显示的函数]';
  if (depth >= ACP_DISPLAY_LIMITS.maxDepth) return DEPTH_TRUNCATION;
  if (typeof value !== 'object') return '[无法显示的值]';
  if (ancestors.has(value)) return CIRCULAR_TRUNCATION;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const truncated = value.length > ACP_DISPLAY_LIMITS.maxArrayItems;
      const itemLimit = truncated
        ? Math.max(0, ACP_DISPLAY_LIMITS.maxArrayItems - 1)
        : value.length;
      const result = value
        .slice(0, itemLimit)
        .map((item) => sanitizeDisplayNode(item, depth + 1, ancestors, budget));
      if (truncated) result.push(`[另有 ${value.length - itemLimit} 项未显示]`);
      return result;
    }

    const record = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      keys.push(key);
      if (keys.length > ACP_DISPLAY_LIMITS.maxObjectKeys) break;
    }
    const truncated = keys.length > ACP_DISPLAY_LIMITS.maxObjectKeys;
    const keyLimit = truncated ? ACP_DISPLAY_LIMITS.maxObjectKeys - 1 : keys.length;
    const result: Record<string, SafeDisplayValue> = Object.create(null) as Record<
      string,
      SafeDisplayValue
    >;

    for (const originalKey of keys.slice(0, keyLimit)) {
      const boundedKey = truncatedText(originalKey, ACP_DISPLAY_LIMITS.maxLabelCharacters).value;
      const key = uniqueObjectKey(result, boundedKey);
      try {
        result[key] = sanitizeDisplayNode(record[originalKey], depth + 1, ancestors, budget);
      } catch {
        result[key] = '[读取字段失败]';
      }
    }
    if (truncated) result.__truncated__ = '[还有更多字段未显示]';
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeSafeDisplayValue(value: unknown): SafeDisplayValue {
  const sanitized = sanitizeDisplayNode(value, 0, new WeakSet<object>(), {
    remainingNodes: 1_024,
    remainingCharacters: ACP_DISPLAY_LIMITS.maxSerializedCharacters,
  });
  try {
    return JSON.stringify(sanitized).length <= ACP_DISPLAY_LIMITS.maxSerializedCharacters
      ? sanitized
      : SIZE_TRUNCATION;
  } catch {
    return '[内容无法安全序列化]';
  }
}

function optionalDisplayValue(value: unknown): SafeDisplayValue | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : sanitizeSafeDisplayValue(value);
}

export function sanitizeToolCall(toolCall: acp.ToolCall | acp.ToolCallUpdate): SanitizedToolCall {
  const sanitized: SanitizedToolCall = {
    toolCallId: sanitizeProtocolIdentifier(toolCall.toolCallId),
  };
  if ('title' in toolCall) {
    sanitized.title =
      toolCall.title === undefined
        ? undefined
        : toolCall.title === null
          ? null
          : truncatedText(toolCall.title, ACP_DISPLAY_LIMITS.maxLabelCharacters).value;
  }
  if ('kind' in toolCall) sanitized.kind = toolCall.kind;
  if ('status' in toolCall) sanitized.status = toolCall.status;
  if ('content' in toolCall) sanitized.content = optionalDisplayValue(toolCall.content);
  if ('rawInput' in toolCall) sanitized.rawInput = optionalDisplayValue(toolCall.rawInput);
  if ('rawOutput' in toolCall) sanitized.rawOutput = optionalDisplayValue(toolCall.rawOutput);
  if ('locations' in toolCall) sanitized.locations = optionalDisplayValue(toolCall.locations);

  if (JSON.stringify(sanitized).length <= ACP_DISPLAY_LIMITS.maxSerializedCharacters) {
    return sanitized;
  }
  return {
    toolCallId: sanitized.toolCallId,
    rawInput: SIZE_TRUNCATION,
  };
}

function fitCollection<T>(source: readonly T[], map: (value: T) => T): CollectionResult<T>;
function fitCollection<T, U>(source: readonly T[], map: (value: T) => U): CollectionResult<U>;
function fitCollection<T, U>(source: readonly T[], map: (value: T) => U): CollectionResult<U> {
  const items: U[] = [];
  let truncated = source.length > ACP_DISPLAY_LIMITS.maxArrayItems;
  const maximum = Math.min(source.length, ACP_DISPLAY_LIMITS.maxArrayItems);
  for (let index = 0; index < maximum; index += 1) {
    const value = source[index];
    if (value === undefined) continue;
    const mapped = map(value);
    if (JSON.stringify([...items, mapped]).length > ACP_DISPLAY_LIMITS.maxCollectionCharacters) {
      truncated = true;
      break;
    }
    items.push(mapped);
  }
  return { items, truncated };
}

function mapPlanEntries(entries: readonly acp.PlanEntry[]): CollectionResult<UiPlanEntry> {
  let fieldTruncated = false;
  const result = fitCollection(entries, (entry) => {
    const content = truncatedText(entry.content, ACP_DISPLAY_LIMITS.maxPlanEntryCharacters);
    fieldTruncated ||= content.truncated;
    return {
      content: content.value,
      priority: entry.priority,
      status: entry.status,
    };
  });
  return { ...result, truncated: result.truncated || fieldTruncated };
}

function mapAvailableCommands(
  commands: readonly acp.AvailableCommand[],
): CollectionResult<UiAvailableCommand> {
  let fieldTruncated = false;
  const result = fitCollection(commands, (command) => {
    const name = truncatedText(command.name, ACP_DISPLAY_LIMITS.maxLabelCharacters);
    const description = truncatedText(
      command.description,
      ACP_DISPLAY_LIMITS.maxPlanEntryCharacters,
    );
    const inputHint =
      command.input === undefined || command.input === null
        ? null
        : truncatedText(command.input.hint, ACP_DISPLAY_LIMITS.maxLabelCharacters);
    fieldTruncated ||= name.truncated || description.truncated || Boolean(inputHint?.truncated);
    return {
      name: name.value,
      description: description.value,
      inputHint: inputHint?.value ?? null,
    };
  });
  return { ...result, truncated: result.truncated || fieldTruncated };
}

function mapSelectOption(
  option: acp.SessionConfigSelectOption,
  markTruncated: () => void,
): UiSessionConfigSelectOption {
  const name = truncatedText(option.name, ACP_DISPLAY_LIMITS.maxLabelCharacters);
  const description =
    option.description === undefined || option.description === null
      ? null
      : truncatedText(option.description, ACP_DISPLAY_LIMITS.maxPlanEntryCharacters);
  if (name.truncated || description?.truncated) markTruncated();
  return {
    value: sanitizeProtocolIdentifier(option.value),
    name: name.value,
    description: description?.value ?? null,
  };
}

function mapSelectGroup(
  group: acp.SessionConfigSelectGroup,
  markTruncated: () => void,
): UiSessionConfigSelectGroup {
  const name = truncatedText(group.name, ACP_DISPLAY_LIMITS.maxLabelCharacters);
  if (name.truncated) markTruncated();
  const options = fitCollection(group.options, (option) => mapSelectOption(option, markTruncated));
  if (options.truncated) markTruncated();
  return {
    group: sanitizeProtocolIdentifier(group.group),
    name: name.value,
    options: options.items,
  };
}

function isSelectGroup(
  option: acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup,
): option is acp.SessionConfigSelectGroup {
  return 'group' in option;
}

function mapConfigOption(
  option: acp.SessionConfigOption,
  markTruncated: () => void,
): UiSessionConfigOption {
  const name = truncatedText(option.name, ACP_DISPLAY_LIMITS.maxLabelCharacters);
  const description =
    option.description === undefined || option.description === null
      ? null
      : truncatedText(option.description, ACP_DISPLAY_LIMITS.maxPlanEntryCharacters);
  const category =
    option.category === undefined || option.category === null
      ? null
      : truncatedText(option.category, ACP_DISPLAY_LIMITS.maxLabelCharacters);
  if (name.truncated || description?.truncated || category?.truncated) markTruncated();
  const base = {
    id: sanitizeProtocolIdentifier(option.id),
    name: name.value,
    description: description?.value ?? null,
    category: category?.value ?? null,
  };
  if (option.type === 'boolean') {
    return { ...base, type: 'boolean', currentValue: option.currentValue };
  }

  const source: Array<acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup> =
    option.options;
  const options = fitCollection(source, (entry) =>
    isSelectGroup(entry)
      ? mapSelectGroup(entry, markTruncated)
      : mapSelectOption(entry, markTruncated),
  );
  if (options.truncated) markTruncated();
  return {
    ...base,
    type: 'select',
    currentValue: sanitizeProtocolIdentifier(option.currentValue),
    options: options.items,
  };
}

function mapConfigOptions(
  options: readonly acp.SessionConfigOption[],
): CollectionResult<UiSessionConfigOption> {
  let nestedTruncated = false;
  const result = fitCollection(options, (option) => {
    return mapConfigOption(option, () => {
      nestedTruncated = true;
    });
  });
  return { ...result, truncated: result.truncated || nestedTruncated };
}

export function sanitizeSessionConfigOptions(
  options: readonly acp.SessionConfigOption[] | null | undefined,
): UiSessionConfigOption[] {
  return options ? mapConfigOptions(options).items : [];
}

export function sanitizeSessionConfigOptionsWithMetadata(
  options: readonly acp.SessionConfigOption[] | null | undefined,
): CollectionResult<UiSessionConfigOption> {
  return options ? mapConfigOptions(options) : { items: [], truncated: false };
}

export function sanitizeTurnUsage(usage: acp.Usage | null | undefined): UiTurnUsage | null {
  if (!usage) return null;
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thoughtTokens: usage.thoughtTokens ?? null,
    cachedReadTokens: usage.cachedReadTokens ?? null,
    cachedWriteTokens: usage.cachedWriteTokens ?? null,
  };
}

function displayChunk(content: acp.ContentBlock): string {
  if (content.type === 'text') {
    return truncatedText(content.text, ACP_DISPLAY_LIMITS.maxStringCharacters).value;
  }
  return `[ACP ${content.type} 内容暂不支持显示]`;
}

function assertNever(value: never): never {
  throw new Error(`未处理的 ACP 事件：${JSON.stringify(value)}`);
}

export function sanitizeAcpSessionUpdate(update: acp.SessionUpdate): UiAcpEvent | null {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return null;
    case 'agent_message_chunk':
      return {
        type: 'message.chunk',
        role: 'assistant',
        messageId:
          update.messageId === undefined || update.messageId === null
            ? null
            : sanitizeProtocolIdentifier(update.messageId),
        text: displayChunk(update.content),
      };
    case 'agent_thought_chunk':
      return {
        type: 'thought.chunk',
        messageId:
          update.messageId === undefined || update.messageId === null
            ? null
            : sanitizeProtocolIdentifier(update.messageId),
        text: displayChunk(update.content),
      };
    case 'tool_call':
    case 'tool_call_update':
      return { type: 'tool.upsert', toolCall: sanitizeToolCall(update) };
    case 'plan': {
      const entries = mapPlanEntries(update.entries);
      return {
        type: 'plan.items',
        planId: null,
        entries: entries.items,
        truncated: entries.truncated,
      };
    }
    case 'plan_update':
      switch (update.plan.type) {
        case 'items': {
          const entries = mapPlanEntries(update.plan.entries);
          return {
            type: 'plan.items',
            planId: sanitizeProtocolIdentifier(update.plan.planId),
            entries: entries.items,
            truncated: entries.truncated,
          };
        }
        case 'markdown': {
          const markdown = truncatedText(
            update.plan.content,
            ACP_DISPLAY_LIMITS.maxMarkdownCharacters,
          );
          return {
            type: 'plan.markdown',
            planId: sanitizeProtocolIdentifier(update.plan.planId),
            markdown: markdown.value,
            truncated: markdown.truncated,
          };
        }
        case 'file': {
          const uri = truncatedText(update.plan.uri, ACP_DISPLAY_LIMITS.maxUriCharacters);
          return {
            type: 'plan.file',
            planId: sanitizeProtocolIdentifier(update.plan.planId),
            uri: uri.value,
            truncated: uri.truncated,
          };
        }
        default:
          return assertNever(update.plan);
      }
    case 'plan_removed':
      return { type: 'plan.remove', planId: sanitizeProtocolIdentifier(update.planId) };
    case 'available_commands_update': {
      const commands = mapAvailableCommands(update.availableCommands);
      return {
        type: 'commands.replace',
        commands: commands.items,
        truncated: commands.truncated,
      };
    }
    case 'current_mode_update':
      return {
        type: 'mode.confirmed',
        currentModeId: sanitizeProtocolIdentifier(update.currentModeId),
      };
    case 'config_option_update': {
      const config = mapConfigOptions(update.configOptions);
      return {
        type: 'config.replace',
        configOptions: config.items,
        truncated: config.truncated,
      };
    }
    case 'session_info_update': {
      const event: Extract<UiAcpEvent, { type: 'session.info.patch' }> = {
        type: 'session.info.patch',
      };
      if (update.title !== undefined) {
        event.title =
          update.title === null
            ? null
            : truncatedText(update.title, ACP_DISPLAY_LIMITS.maxLabelCharacters).value;
      }
      if (update.updatedAt !== undefined) {
        event.updatedAt =
          update.updatedAt === null
            ? null
            : truncatedText(update.updatedAt, ACP_DISPLAY_LIMITS.maxLabelCharacters).value;
      }
      return event;
    }
    case 'usage_update':
      return {
        type: 'usage.replace',
        usage: {
          used: update.used,
          size: update.size,
          cost: update.cost
            ? {
                amount: update.cost.amount,
                currency: truncatedText(update.cost.currency, ACP_DISPLAY_LIMITS.maxLabelCharacters)
                  .value,
              }
            : null,
        },
      };
    default:
      return assertNever(update);
  }
}
