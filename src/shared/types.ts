export type ConnectionStatus =
  | 'checking'
  | 'detected'
  | 'connecting'
  | 'ready'
  | 'offline'
  | 'error';

export type ConnectionIssueCode =
  | 'binary_missing'
  | 'version_check_failed'
  | 'authentication_required'
  | 'authentication_failed'
  | 'authentication_unsupported'
  | 'protocol_incompatible'
  | 'protocol_invalid'
  | 'timeout'
  | 'process_failed'
  | 'channel_closed'
  | 'unknown';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'working'
  | 'cancelling'
  | 'awaiting_permission'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
}

export interface GrokStatus {
  status: ConnectionStatus;
  binaryPath: string | null;
  version: string | null;
  authenticated: boolean | null;
  detail?: string;
  issueCode?: ConnectionIssueCode;
  retryable?: boolean;
}

export interface ProjectSummary {
  path: string;
  name: string;
  branch: string | null;
  isGitRepository: boolean;
  changedFiles: number;
  statusLines: string[];
  diffStat: string;
}

export interface SessionModeOption {
  id: string;
  name: string;
  description?: string | null;
}

export type SafeDisplayValue =
  | string
  | number
  | boolean
  | null
  | SafeDisplayValue[]
  | { [key: string]: SafeDisplayValue };

export type UiToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type UiToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface SanitizedToolCall {
  toolCallId: string;
  title?: string | null;
  kind?: UiToolKind | null;
  status?: UiToolStatus | null;
  content?: SafeDisplayValue | null;
  rawInput?: SafeDisplayValue | null;
  rawOutput?: SafeDisplayValue | null;
  locations?: SafeDisplayValue | null;
}

export interface UiPlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UiUsageCost {
  amount: number;
  currency: string;
}

export interface UiUsage {
  used: number;
  size: number;
  cost: UiUsageCost | null;
}

export interface UiTurnUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
}

export interface UiAvailableCommand {
  name: string;
  description: string;
  inputHint: string | null;
}

export interface UiSessionConfigSelectOption {
  value: string;
  name: string;
  description: string | null;
}

export interface UiSessionConfigSelectGroup {
  group: string;
  name: string;
  options: UiSessionConfigSelectOption[];
}

interface UiSessionConfigOptionBase {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

export type UiSessionConfigOption =
  | (UiSessionConfigOptionBase & {
      type: 'select';
      currentValue: string;
      options: Array<UiSessionConfigSelectOption | UiSessionConfigSelectGroup>;
    })
  | (UiSessionConfigOptionBase & {
      type: 'boolean';
      currentValue: boolean;
    });

export type UiStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export type UiAcpEvent =
  | {
      type: 'message.chunk';
      role: 'user' | 'assistant';
      messageId: string | null;
      text: string;
    }
  | {
      type: 'thought.chunk';
      messageId: string | null;
      text: string;
    }
  | { type: 'tool.upsert'; toolCall: SanitizedToolCall }
  | {
      type: 'plan.items';
      planId: string | null;
      entries: UiPlanEntry[];
      truncated: boolean;
    }
  | { type: 'plan.markdown'; planId: string; markdown: string; truncated: boolean }
  | { type: 'plan.file'; planId: string; uri: string; truncated: boolean }
  | { type: 'plan.remove'; planId: string }
  | { type: 'commands.replace'; commands: UiAvailableCommand[]; truncated: boolean }
  | { type: 'mode.confirmed'; currentModeId: string }
  | {
      type: 'config.replace';
      configOptions: UiSessionConfigOption[];
      truncated: boolean;
    }
  | { type: 'session.info.patch'; title?: string | null; updatedAt?: string | null }
  | { type: 'usage.replace'; usage: UiUsage }
  | { type: 'turn.completed'; stopReason: UiStopReason; usage: UiTurnUsage | null }
  | { type: 'turn.failed'; detail: string };

export interface CreatedSession {
  sessionId: string;
  currentModeId: string | null;
  availableModes: SessionModeOption[];
  configOptions: UiSessionConfigOption[];
  configOptionsTruncated: boolean;
}

export interface PromptResult {
  sessionId: string;
  stopReason: string;
  usage?: unknown;
}

export interface AcpSessionEvent {
  sessionId: string;
  event: UiAcpEvent;
}

export interface GrokConnectionEvent {
  status: ConnectionStatus;
  detail?: string;
  agentName?: string;
  agentVersion?: string;
  authenticated?: boolean | null;
  authMethod?: string | null;
  logoutSupported?: boolean;
  issueCode?: ConnectionIssueCode;
  retryable?: boolean;
}

export interface GrokLogoutResult {
  confirmed: boolean;
  status: 'logged_out' | 'already_logged_out' | 'failed';
  accountLabel: string | null;
  detail: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequestEvent {
  requestId: string;
  sessionId: string;
  workspacePath: string;
  expiresAt: number;
  toolCall: SanitizedToolCall;
  options: PermissionOption[];
}

export interface PermissionResolution {
  requestId: string;
  optionId?: string;
  cancelled?: boolean;
}

export interface PermissionClearedEvent {
  requestId: string;
}

export interface GrokDesktopApi {
  reportRendererReady(): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
  chooseDirectory(): Promise<ProjectSummary | null>;
  inspectProject(path: string): Promise<ProjectSummary>;
  checkGrok(): Promise<GrokStatus>;
  connectGrok(): Promise<GrokConnectionEvent>;
  reconnectGrok(): Promise<GrokConnectionEvent>;
  logoutGrok(): Promise<GrokLogoutResult>;
  createSession(cwd: string): Promise<CreatedSession>;
  sendPrompt(sessionId: string, text: string): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  setSessionMode(sessionId: string, modeId: string): Promise<void>;
  resolvePermission(resolution: PermissionResolution): Promise<void>;
  onSessionUpdate(listener: (event: AcpSessionEvent) => void): () => void;
  onPermissionRequest(listener: (event: PermissionRequestEvent) => void): () => void;
  onPermissionCleared(listener: (event: PermissionClearedEvent) => void): () => void;
  onConnectionEvent(listener: (event: GrokConnectionEvent) => void): () => void;
}
