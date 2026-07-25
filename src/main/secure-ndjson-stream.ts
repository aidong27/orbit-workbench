import type { AnyMessage, Stream } from '@agentclientprotocol/sdk';

const INVALID_FRAME_MESSAGE = 'Grok ACP 返回了无法解析的协议帧。';
const GROK_VENDOR_NOTIFICATION_PREFIX = '_x.ai/';
const MAX_VENDOR_METHOD_CHARACTERS = 256;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isContentBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string';
    case 'image':
    case 'audio':
      return typeof value.data === 'string' && typeof value.mimeType === 'string';
    case 'resource_link':
      return typeof value.name === 'string' && typeof value.uri === 'string';
    case 'resource':
      return (
        isRecord(value.resource) &&
        typeof value.resource.uri === 'string' &&
        (typeof value.resource.text === 'string' || typeof value.resource.blob === 'string')
      );
    default:
      return false;
  }
}

function isSessionUpdate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.sessionUpdate !== 'string') return false;
  switch (value.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return isContentBlock(value.content);
    case 'tool_call':
      return typeof value.toolCallId === 'string' && typeof value.title === 'string';
    case 'tool_call_update':
      return typeof value.toolCallId === 'string';
    case 'plan':
      return 'entries' in value;
    case 'plan_update': {
      if (!isRecord(value.plan) || typeof value.plan.planId !== 'string') return false;
      if (value.plan.type === 'items') return 'entries' in value.plan;
      if (value.plan.type === 'markdown') return typeof value.plan.content === 'string';
      if (value.plan.type === 'file') return typeof value.plan.uri === 'string';
      return false;
    }
    case 'plan_removed':
      return typeof value.planId === 'string';
    case 'available_commands_update':
      return 'availableCommands' in value;
    case 'current_mode_update':
      return typeof value.currentModeId === 'string';
    case 'config_option_update':
      return 'configOptions' in value;
    case 'session_info_update':
      return true;
    case 'usage_update':
      return typeof value.used === 'number' && typeof value.size === 'number';
    default:
      return false;
  }
}

function isSafeNotification(message: JsonRecord): boolean {
  if (message.method === '$/cancel_request') {
    return (
      isRecord(message.params) &&
      'requestId' in message.params &&
      isJsonRpcId(message.params.requestId)
    );
  }
  if (message.method !== 'session/update') return false;
  return (
    isRecord(message.params) &&
    typeof message.params.sessionId === 'string' &&
    isSessionUpdate(message.params.update)
  );
}

function isSafeIgnoredVendorNotification(message: JsonRecord): boolean {
  if (
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string' ||
    message.method.length <= GROK_VENDOR_NOTIFICATION_PREFIX.length ||
    message.method.length > MAX_VENDOR_METHOD_CHARACTERS ||
    !message.method.startsWith(GROK_VENDOR_NOTIFICATION_PREFIX) ||
    Object.hasOwn(message, 'id') ||
    Object.hasOwn(message, 'result') ||
    Object.hasOwn(message, 'error')
  ) {
    return false;
  }
  return isRecord(message.params);
}

function isJsonRpcMessage(value: unknown): value is AnyMessage {
  if (!isRecord(value) || value.jsonrpc !== '2.0') return false;
  if ('method' in value) {
    if (typeof value.method !== 'string') return false;
    if ('id' in value) return isJsonRpcId(value.id);
    return isSafeNotification(value);
  }
  if (!('id' in value) || !isJsonRpcId(value.id)) return false;
  const hasResult = Object.hasOwn(value, 'result');
  const hasError = Object.hasOwn(value, 'error');
  if (hasResult === hasError) return false;
  return (
    !hasError ||
    (isRecord(value.error) &&
      Number.isInteger(value.error.code) &&
      typeof value.error.message === 'string')
  );
}

function parseMessage(line: string): AnyMessage | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (isRecord(value) && isSafeIgnoredVendorNotification(value)) {
      return null;
    }
    if (!isJsonRpcMessage(value)) {
      throw new Error(INVALID_FRAME_MESSAGE);
    }
    return value as AnyMessage;
  } catch {
    throw new Error(INVALID_FRAME_MESSAGE);
  }
}

export function secureNdjsonStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
): Stream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let inputReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      const reader = input.getReader();
      inputReader = reader;
      let buffer = '';
      const emitLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const message = parseMessage(trimmed);
        if (message) controller.enqueue(message);
      };
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            emitLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
          }
        }
        if (cancelled) return;
        buffer += decoder.decode();
        emitLine(buffer);
        controller.close();
      } catch {
        if (!cancelled) controller.error(new Error(INVALID_FRAME_MESSAGE));
      } finally {
        if (inputReader === reader) inputReader = undefined;
        reader.releaseLock();
      }
    },
    cancel(reason) {
      cancelled = true;
      return inputReader?.cancel(reason);
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const writer = output.getWriter();
      try {
        await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
      } finally {
        writer.releaseLock();
      }
    },
  });

  return { readable, writable };
}

export const secureNdjsonTestHelpers = { INVALID_FRAME_MESSAGE };
