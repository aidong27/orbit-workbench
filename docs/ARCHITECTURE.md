# 架构说明

## 进程边界

### 渲染进程

React 负责中文界面、会话时间线、检查器、命令面板与本地界面偏好。渲染进程不直接访问文件系统、环境变量或子进程。

### 预加载桥接

`src/preload/index.ts` 通过 `contextBridge` 只暴露固定的 `GrokDesktopApi`：

- 选择和检查工作区。
- 检测/连接本机 Grok。
- 创建会话、发送提示、取消和切换模式。
- 订阅 ACP 更新、权限请求与连接状态。

### 主进程

`src/main/grok-acp.ts` 启动 `grok --no-auto-update agent stdio`，使用官方 `@agentclientprotocol/sdk` 建立 ACP 连接。主进程将 JSON-RPC 更新原样传到渲染层，但把生命周期、超时与权限 Promise 留在受信任进程。

一个桌面进程复用一个 Grok ACP 子进程；每个工作任务拥有独立 ACP Session ID。并发权限请求在界面中按到达顺序排队。窗口退出时会取消等待中的权限请求并终止子进程；如果 ACP 意外退出，进程级 Session ID 会立即失效，下一条任务将建立新会话。

## 事件归一化

`src/renderer/src/state/reducer.ts` 将 ACP 更新转换成稳定的时间线对象：

- `agent_message_chunk` → 合并为流式助手消息。
- `agent_thought_chunk` → 可折叠的过程摘要。
- `tool_call` / `tool_call_update` → 按 `toolCallId` 原位更新。
- `plan` / `plan_update` → 当前结构化计划。
- `current_mode_update` → 会话模式。
- `usage_update` → 上下文用量。
- 本地主进程完成/异常事件 → 明确的完成、取消或失败状态。

## 本地恢复

客户端只把工作区、界面偏好、会话标题和裁剪后的时间线写入本机 `localStorage`。最多保留 40 个会话、每个会话 160 条时间线；工具原始输入、输出和中间载荷不会持久化。ACP Session ID、模式能力和权限队列都属于当前子进程，恢复时会被清空。

## 计划模式兼容

ACP 会话如果返回原生 `availableModes`，客户端调用 `session/set_mode`。当前 Grok Build 某些版本没有通过 ACP 返回模式列表，因此界面在这种情况下将“计划”选择转换为下一条提示的 `/plan <任务>`，以保持与官方 TUI 命令一致。

## 已知范围

首个版本聚焦本地 macOS 单窗口工作流。以下功能保留到后续版本：

- 从 Grok 会话库恢复完整历史。
- 多代理 Dashboard 与 Worktree 管理。
- 文件 `@` 自动补全和附件传输。
- 行级 Diff 审阅与编辑器跳转。
- 插件、Skills、Hooks 和 MCP 管理界面。
- 正式签名、公证、自动更新与跨平台安装包。
