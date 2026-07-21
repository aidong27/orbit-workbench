import type * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import {
  ACP_DISPLAY_LIMITS,
  sanitizeAcpSessionUpdate,
  sanitizeSafeDisplayValue,
  sanitizeSessionConfigOptions,
} from './acp-event-sanitizer';

describe('sanitizeAcpSessionUpdate', () => {
  it('maps item, markdown, and file plan updates using the ACP 1.2.1 shape', () => {
    const itemsUpdate = {
      sessionUpdate: 'plan_update',
      plan: {
        type: 'items',
        planId: 'plan-items',
        entries: [],
      },
    } satisfies acp.SessionUpdate;
    const markdownUpdate = {
      sessionUpdate: 'plan_update',
      plan: {
        type: 'markdown',
        planId: 'plan-markdown',
        content: '## 实施计划\n\n1. 修复协议映射',
      },
    } satisfies acp.SessionUpdate;
    const fileUpdate = {
      sessionUpdate: 'plan_update',
      plan: {
        type: 'file',
        planId: 'plan-file',
        uri: 'file:///workspace/PLAN.md',
      },
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(itemsUpdate)).toEqual({
      type: 'plan.items',
      planId: 'plan-items',
      entries: [],
      truncated: false,
    });
    expect(sanitizeAcpSessionUpdate(markdownUpdate)).toEqual({
      type: 'plan.markdown',
      planId: 'plan-markdown',
      markdown: '## 实施计划\n\n1. 修复协议映射',
      truncated: false,
    });
    expect(sanitizeAcpSessionUpdate(fileUpdate)).toEqual({
      type: 'plan.file',
      planId: 'plan-file',
      uri: 'file:///workspace/PLAN.md',
      truncated: false,
    });
  });

  it('preserves empty baseline plans and removes only the addressed plan id', () => {
    const baseline = {
      sessionUpdate: 'plan',
      entries: [],
    } satisfies acp.SessionUpdate;
    const removed = {
      sessionUpdate: 'plan_removed',
      planId: 'plan-b',
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(baseline)).toEqual({
      type: 'plan.items',
      planId: null,
      entries: [],
      truncated: false,
    });
    expect(sanitizeAcpSessionUpdate(removed)).toEqual({
      type: 'plan.remove',
      planId: 'plan-b',
    });
  });

  it('preserves nullable message ids and uses an explicit placeholder for non-text content', () => {
    const identified = {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'message-1',
      content: { type: 'text', text: '第一段' },
    } satisfies acp.SessionUpdate;
    const withoutId = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: '正在分析' },
    } satisfies acp.SessionUpdate;
    const image = {
      sessionUpdate: 'agent_message_chunk',
      messageId: null,
      content: { type: 'image', data: 'base64', mimeType: 'image/png' },
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(identified)).toEqual({
      type: 'message.chunk',
      role: 'assistant',
      messageId: 'message-1',
      text: '第一段',
    });
    expect(sanitizeAcpSessionUpdate(withoutId)).toEqual({
      type: 'thought.chunk',
      messageId: null,
      text: '正在分析',
    });
    expect(sanitizeAcpSessionUpdate(image)).toEqual({
      type: 'message.chunk',
      role: 'assistant',
      messageId: null,
      text: '[ACP image 内容暂不支持显示]',
    });
  });

  it('does not forward user history chunks until session replay is implemented', () => {
    const update = {
      sessionUpdate: 'user_message_chunk',
      messageId: 'user-1',
      content: { type: 'text', text: '历史消息' },
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(update)).toBeNull();
  });

  it('bounds oversized and deeply nested tool payloads', () => {
    const oversized = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-large',
      title: '读取大量输出',
      kind: 'read',
      status: 'in_progress',
      rawOutput: 'x'.repeat(ACP_DISPLAY_LIMITS.maxSerializedCharacters * 3),
    } satisfies acp.SessionUpdate;

    const event = sanitizeAcpSessionUpdate(oversized);
    expect(event?.type).toBe('tool.upsert');
    expect(JSON.stringify(event).length).toBeLessThanOrEqual(
      ACP_DISPLAY_LIMITS.maxSerializedCharacters,
    );
    if (event?.type === 'tool.upsert') {
      expect(String(event.toolCall.rawOutput ?? event.toolCall.rawInput)).toContain('截断');
    }

    let deep: Record<string, unknown> = { leaf: 'value' };
    for (let index = 0; index < ACP_DISPLAY_LIMITS.maxDepth + 4; index += 1) {
      deep = { next: deep };
    }
    const deepValue = sanitizeSafeDisplayValue(deep);
    expect(JSON.stringify(deepValue)).toContain('嵌套过深');
  });

  it('preserves absent versus explicit null fields in tool-call patches', () => {
    const absent = sanitizeAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-patch',
      status: 'completed',
    } satisfies acp.SessionUpdate);
    const cleared = sanitizeAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-patch',
      title: null,
      rawOutput: null,
    } satisfies acp.SessionUpdate);

    expect(absent).toEqual({
      type: 'tool.upsert',
      toolCall: { toolCallId: 'tool-patch', status: 'completed' },
    });
    expect(cleared).toEqual({
      type: 'tool.upsert',
      toolCall: { toolCallId: 'tool-patch', title: null, rawOutput: null },
    });
  });

  it('strictly caps array items and object keys in display values', () => {
    const array = sanitizeSafeDisplayValue(
      Array.from({ length: ACP_DISPLAY_LIMITS.maxArrayItems + 20 }, (_, index) => index),
    );
    expect(Array.isArray(array)).toBe(true);
    if (Array.isArray(array)) expect(array).toHaveLength(ACP_DISPLAY_LIMITS.maxArrayItems);

    const object = sanitizeSafeDisplayValue(
      Object.fromEntries(
        Array.from({ length: ACP_DISPLAY_LIMITS.maxObjectKeys + 20 }, (_, index) => [
          `key-${index}`,
          index,
        ]),
      ),
    );
    expect(object).not.toBeNull();
    expect(Array.isArray(object)).toBe(false);
    if (object && typeof object === 'object' && !Array.isArray(object)) {
      expect(Object.keys(object)).toHaveLength(ACP_DISPLAY_LIMITS.maxObjectKeys);
      expect(object.__truncated__).toContain('字段未显示');
    }
  });

  it('maps commands, config options, and context usage as full replacements', () => {
    const commands = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        {
          name: 'review',
          description: '审查当前工作区',
          input: { hint: '可选：文件路径' },
        },
      ],
    } satisfies acp.SessionUpdate;
    const config = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: '模型',
          category: 'model',
          currentValue: 'grok-code',
          options: [
            { value: 'grok-code', name: 'Grok Code' },
            { value: 'grok-fast', name: 'Grok Fast', description: '更低延迟' },
          ],
        },
        {
          type: 'boolean',
          id: 'thinking',
          name: '深度思考',
          category: 'thought_level',
          currentValue: true,
        },
      ],
    } satisfies acp.SessionUpdate;
    const usage = {
      sessionUpdate: 'usage_update',
      used: 4_096,
      size: 128_000,
      cost: { amount: 0.42, currency: 'USD' },
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(commands)).toEqual({
      type: 'commands.replace',
      commands: [
        {
          name: 'review',
          description: '审查当前工作区',
          inputHint: '可选：文件路径',
        },
      ],
      truncated: false,
    });
    expect(sanitizeAcpSessionUpdate(config)).toMatchObject({
      type: 'config.replace',
      truncated: false,
      configOptions: [
        {
          type: 'select',
          id: 'model',
          currentValue: 'grok-code',
          options: [{ value: 'grok-code' }, { value: 'grok-fast' }],
        },
        { type: 'boolean', id: 'thinking', currentValue: true },
      ],
    });
    expect(sanitizeAcpSessionUpdate(usage)).toEqual({
      type: 'usage.replace',
      usage: {
        used: 4_096,
        size: 128_000,
        cost: { amount: 0.42, currency: 'USD' },
      },
    });
    expect(sanitizeSessionConfigOptions(config.configOptions)).toHaveLength(2);
  });

  it('preserves null semantics in session information patches', () => {
    const update = {
      sessionUpdate: 'session_info_update',
      title: null,
      updatedAt: '2026-07-21T00:00:00.000Z',
    } satisfies acp.SessionUpdate;

    expect(sanitizeAcpSessionUpdate(update)).toEqual({
      type: 'session.info.patch',
      title: null,
      updatedAt: '2026-07-21T00:00:00.000Z',
    });
  });
});
