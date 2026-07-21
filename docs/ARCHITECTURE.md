<!-- markdownlint-disable MD013 -->

# 架构说明

星轨工作台是一个本地优先的 Electron 客户端。它不实现模型服务，也不接管 Grok Build 的认证；它把用户本机 CLI 暴露的 Agent Client Protocol（ACP）转换为可审阅的中文桌面工作流。

## 系统边界

```text
┌──────────────────────────────────────────────────────────┐
│ Renderer: React                                          │
│ 工作区 / 时间线 / 工具状态 / 权限 UI / 本地显示偏好      │
│ sandbox=true · contextIsolation=true · nodeIntegration=false │
└───────────────────────┬──────────────────────────────────┘
                        │ 固定 IPC 能力
┌───────────────────────▼──────────────────────────────────┐
│ Preload: contextBridge                                   │
│ 仅暴露 GrokDesktopApi，不传出 ipcRenderer                │
└───────────────────────┬──────────────────────────────────┘
                        │ 主 frame、参数和路径重新验证
┌───────────────────────▼──────────────────────────────────┐
│ Main: Electron                                           │
│ 窗口生命周期 / ACP 净化 / Session 所有权 / 权限 Broker   │
└───────────────────────┬──────────────────────────────────┘
                        │ ACP / JSON-RPC over stdio
┌───────────────────────▼──────────────────────────────────┐
│ 用户安装的 Grok Build CLI                                │
│ 登录 / 模型请求 / 工具执行 / 上游权限策略                │
└──────────────────────────────────────────────────────────┘
```

## 进程职责

### 渲染进程

React 负责中文界面、会话时间线、检查器、命令面板和界面偏好。渲染进程不直接访问文件系统、环境变量、Git 或子进程。

来自代理的 Markdown 被当作不可信内容处理。外部链接不能在应用内获得 Electron 能力，只允许经过主进程协议检查后交给系统浏览器。

### 预加载桥接

`src/preload/index.ts` 使用 `contextBridge` 暴露固定的 `GrokDesktopApi`：

- 选择和检查工作区；
- 检测、连接本机 Grok CLI；
- 创建会话、发送提示、取消和切换模式；
- 订阅 ACP 更新、权限请求与连接状态。

桥接不会把通用 IPC、文件系统或 shell 接口暴露给页面。

### 主进程

主进程负责：

- 校验 IPC 是否来自主窗口的主 frame；
- 将工作区解析为真实目录并限制参数类型/长度；
- 使用 `execFile` 和固定参数数组读取 Git 状态；
- 查找并启动 Grok Build CLI；
- 管理 ACP 连接、Session ID、超时与并发权限请求；
- 将 SDK 原始更新转换为 renderer 专用的类型化、限长事件；
- 校验 session 与窗口所有权，只向来源窗口发送会话和权限事件；
- 在应用退出或连接失效时清理会话和子进程。

Grok 子进程使用最小化环境白名单：保留 CLI 启动所需的系统运行时、`GROK_*`、`XAI_API_KEY`、代理和证书变量，不默认继承其他开发凭据，并始终拒绝 Node/Electron 运行时注入变量。

## 平台适配

### macOS arm64

CLI 查找顺序：

1. `GROK_BINARY` 指定的绝对路径；
2. `~/.grok/bin/grok`；
3. 通过 `/usr/bin/env which grok` 查询 `PATH`。

退出时先请求正常终止，超时后再结束整个进程组。

### Windows x64

CLI 查找顺序：

1. `GROK_BINARY` 指向的 `grok.exe`；
2. `%USERPROFILE%\.grok\bin\grok.exe`；
3. 通过 `where.exe grok.exe` 查询 `PATH`。

Windows 只接受 `.exe` 形式的 CLI 路径。子进程以隐藏窗口启动；受控退出时使用 `taskkill.exe /t /f` 请求终止对应 PID 的进程树，降低 ACP 后台进程遗留风险。

## ACP 生命周期

一个桌面进程复用一个 Grok ACP 子进程，每个工作任务拥有独立 ACP Session ID：

1. 检测 CLI 并执行 `--version`；
2. 启动 `grok --no-auto-update agent stdio`；
3. ACP `initialize`，复用 CLI 已有认证；
4. 为工作区创建 session；
5. 在主进程把 SDK 更新净化为 `UiAcpEvent`，再通过受限 IPC 推送；
6. 权限请求在主进程保留 Promise，并附带来源工作区、路径、会话和到期时间；
7. 取消、断线或退出时使 Session ID 失效并清理等待请求。

连接、创建会话和切换模式有明确操作超时。长任务使用“事件空闲”watchdog，而不是简单的总时长上限：消息、工具或计划更新会刷新计时；等待权限时暂停计时。取消后若会话未在有限时间内收敛，客户端会使当前 ACP 连接失效并重建本地代理。进程意外退出后，旧连接和 Session ID 不会被复用。

## 事件归一化

`src/main/acp-event-sanitizer.ts` 是 ACP SDK 与应用协议之间的唯一适配边界。它使用 SDK 判别联合识别事件，限制字符串、递归深度、集合项数和序列化总量，再生成 `UiAcpEvent`。SDK 原始对象不会直接进入 renderer。

`src/renderer/src/state/reducer.ts` 只消费类型化应用事件，并转换成稳定的时间线对象：

- `message.chunk` → 按 ACP `messageId` 精确归并流式助手消息；
- `thought.chunk` → 按 ACP `messageId` 归并可折叠过程摘要；
- `tool_call` / `tool_call_update` → 按 `toolCallId` 原位更新；
- `plan.items` / `plan.markdown` / `plan.file` / `plan.remove` → ACP 1.2.1 的多种计划表达；
- `mode.confirmed` → 服务端已确认的会话模式；
- `commands.replace` / `config.replace` / `usage.replace` → 能力、配置与用量；
- 本地主进程完成/异常事件 → 明确的完成、取消或失败状态。

渲染层使用 `requestedModeId`、`confirmedModeId` 与切换状态区分用户意图和服务端事实；只有 ACP 调用成功或收到确认事件后才更新已确认模式。归一化层不把原始工具载荷写入持久化存储。

## 本地数据

客户端使用带 `schemaVersion` 与保存时间的 v2 信封，把工作区路径、最近一次 Git 分支/文件状态/差异统计快照、界面偏好、会话标题和裁剪后的时间线写入 Electron 本机存储；当前不加密。加载时经 Zod 校验、v1 迁移和引用修复；演示实体不进入正式持久化。最多保留 40 个会话、每个会话 160 条时间线，并对单条消息和单会话持久化体积设置上限。工具原始输入、输出和中间载荷不会持久化。ACP Session ID、已确认模式、可用模式和权限队列只属于当前进程。

含时间线的恢复会话会被标记为 `local-history-only`。它只代表“本机仍有可查看的记录”，不代表 Grok Build 已恢复代理上下文；用户必须显式创建新任务，应用不会在旧时间线下静默创建空白 ACP 会话。输入草稿也按本地会话隔离，避免跨项目误发，但当前不会持久化到磁盘。

这里的“本地优先”不等于模型请求离线：实际模型通信仍由用户的 Grok Build CLI 按其自身条款和设置完成。

## 计划模式兼容

如果 ACP 会话返回原生 `availableModes`，客户端调用 `session/set_mode`，等待成功后才更新已确认模式；失败时保留原模式并显示原因。某些 CLI 版本未通过 ACP 返回模式列表，此时界面把下一条“计划”提示转换为 `/plan <任务>`，与 CLI 命令保持兼容。

## 打包与发布

- Windows x64：NSIS 安装包与 Portable 可执行文件；
- macOS arm64：DMG 与 ZIP；
- `asar` 封装应用代码；
- Electron fuses 禁用 RunAsNode、Node options 和 CLI 调试参数，并启用 ASAR 完整性校验及仅从 ASAR 加载；
- CI 固定第三方 Action 的提交 SHA，在干净环境中构建两个平台，启动最终 DMG、ZIP、NSIS 与 Portable 产物，并生成 SHA-256 清单。
- 生产依赖与 Electron 的完整许可证正文、Chromium notices 随最终包分发，并由 `pnpm licenses:check` 与平台工作流验证。

当前 Alpha 的 Windows 包尚未商业代码签名；macOS 包仅使用 ad-hoc 签名，尚未使用 Apple Developer ID 签名或公证。可验证更新和发布来源证明属于正式发布前的独立安全里程碑。

## 已知范围

- 不从上游会话库恢复完整历史；
- 已有真实 stdio/NDJSON Fake ACP Agent 核心路径测试，但尚未覆盖全部崩溃、停滞与平台进程树场景；
- 不包含多代理 Dashboard 或 Worktree 管理；
- 不提供文件 `@` 自动补全、附件传输或行级 Diff 编辑；
- 不管理插件、Skills、Hooks 或 MCP 服务器；
- 不支持 Linux；
- 不包含自动更新。
