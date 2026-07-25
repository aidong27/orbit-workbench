<!-- markdownlint-disable MD024 -->

# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- Windows 与 macOS 正式代码签名。
- 自动更新与可验证的发布来源。
- Linux 支持评估。

## [0.2.0-alpha.3] - 2026-07-25

### Added

- 首次连接引导，按 CLI 检测、ACP 连接、工作区选择和任务起步展示真实进度。
- 可重试的连接中心，展示 CLI 路径/版本、Agent 版本、故障代码和可复制的脱敏诊断。
- 空会话中文安全任务模板；模板只写入会话草稿，不会自动发送。
- 独立、可测试的 renderer 连接控制器和连接状态回归测试。
- v3 本地状态信封，支持合法空状态与 v2/v1 事务式迁移。

### Changed

- 检测到 CLI 改为 `detected` 预检状态；只有 ACP 初始化和认证成功才进入 `ready`。
- 未连接时 Composer 保留可编辑草稿，但禁用发送与模式切换，并就地提供恢复动作。
- 顶部与侧栏的 Grok 状态改为可操作的连接中心入口。
- 基础字号提升到 15px，信息性文字不低于 11px，并提高文本/占位符对比度。
- 1180px 以下的右侧检查器改为覆盖抽屉；命令面板和检查器补充键盘导航语义。
- 工作区、Git 和权限错误改为非阻塞应用通知。

### Fixed

- 兼容 Grok Build 0.2.112 的 `_x.ai/*` 合法扩展通知，不再误报“无法解析的协议帧”。
- 主进程连接失败通过结构化结果返回，避免界面暴露 Electron `Error invoking remote method` 包装文案。
- 删除最后工作区或首次空状态后，旧 v2 数据不再在重启时复活。

### Security

- `_x.ai/*` 通知仅在 JSON-RPC envelope、method 和 params 均满足严格边界时被忽略；带 ID request 不会被吞掉。
- 现有 4 MiB 单帧限制、未知非 vendor 通知拒绝和固定脱敏错误保持不变。

## [0.2.0-alpha.2] - 2026-07-21

### Added

- 在主进程加入 ACP 事件净化层，将 SDK 判别联合转换为 renderer 专用的类型化事件协议。
- 支持 `messageId` 驱动的消息/过程分片归并，以及 items、Markdown、file 三种 `plan_update` 表达。
- 权限确认显示来源工作区、绝对路径和会话；后台会话请求可直接切换到来源。
- 权限与工具载荷加入字符串、递归深度、数组/对象字段数和序列化总量限制。
- 任务执行加入事件空闲 watchdog、有限时间取消收敛和强制重建本地代理连接的兜底路径。
- 本地状态升级为带 `schemaVersion` 的 v2 信封，加载时校验、迁移和修复失效引用。
- 加入真实 stdio/NDJSON Fake ACP Agent 集成测试，覆盖交错消息、三种计划格式、权限回映射和模式拒绝。
- 加入 Composer、权限弹窗和时间线的组件回归测试。
- 加入可重复生成并由 CI 校验的完整生产依赖许可证清单，以及 Electron Chromium notices。

### Changed

- 从本地恢复且含时间线的会话明确标记为“仅本地历史”，不再静默创建新 ACP 会话伪装继续。
- 模式状态区分“用户请求”和“服务端确认”；切换失败保留已确认模式并显示错误。
- Grok 子进程不再继承整个 `process.env`，改为运行时、Grok/xAI、代理和证书变量白名单，并始终拒绝 Node/Electron 注入变量。
- 输入草稿按会话隔离；中文输入法仍在组词时，Enter 不会提交任务。
- 流式消息按 animation frame 批量刷新，并按协议消息 ID 精确归并。
- 工具失败和本地取消使用独立终态，不再显示为仍在执行。
- 会话创建期间的早到事件经双层有界缓冲保序；溢出或未知模式会使连接明确失败，不再静默丢弃。

### Security

- SDK 原始 ACP 对象不再直接进入 renderer；权限 ID、工具内容、计划、命令和配置均在主进程限长与净化。
- ACP stdout 在进入 SDK 前执行 4 MiB 单帧上限和 JSON-RPC/会话通知结构校验；畸形帧错误不会回显原始载荷。
- 所有 session IPC 校验窗口所有权；会话事件和权限请求只发送给其所属窗口。
- 权限等待暂停任务空闲 watchdog，提交后恢复；超时、断线与取消都会清理待处理权限。
- 打包阶段启用 Electron fuses：禁用 RunAsNode、Node options 与调试参数，并启用 ASAR 完整性校验和仅从 ASAR 加载。
- GitHub Actions 固定到提交 SHA；平台工作流启动最终 DMG、ZIP、NSIS、Portable 产物并生成 SHA-256 清单。
- 最终安装包包含生产依赖、Electron 和 Chromium 的完整许可证正文，工作流会验证这些文件存在。

### Known limitations

- 本版本不会从 Grok Build 的上游会话库恢复代理上下文；重启后旧会话只能查看，继续工作需要显式新建任务。
- 已有聚焦核心路径的 Fake ACP Agent 集成测试，但尚未覆盖全部崩溃、停滞和平台进程树场景。
- Windows 与 macOS 安装包仍未正式签名或 Apple 公证；macOS hardened runtime 仍未启用。

## [0.2.0-alpha.1] - 2026-07-20

### Added

- Windows x64 NSIS 安装包和 Portable 便携包配置。
- Windows `grok.exe` 默认路径、`PATH` 与 `GROK_BINARY` 检测。
- Windows 进程树关闭、平台路径和 IPC 安全回归测试。
- Windows 与 macOS 独立打包验证工作流。
- Orbit Workbench 独立品牌、双语项目主页和开源治理文档。
- Apache License 2.0、第三方组件与非官方商标声明。

### Changed

- 产品名称统一为“星轨工作台 / Orbit Workbench”。
- Grok ACP 客户端版本从应用元数据读取，不再硬编码。
- 会话生命周期加入超时、连接失效清理与更完整的退出流程。
- 本地路径、外部链接和渲染内容采用更严格的校验与安全默认值。

### Security

- Windows 子进程使用无窗口启动，并在受控退出时通过 `taskkill /t /f` 终止对应进程树。
- 主进程限制 IPC 来源、参数形状、URL 协议和工作区真实路径。
- 外部链接只允许受支持的安全协议，并由系统浏览器打开。

### Known limitations

- Windows 安装包与 renderer/preload 握手由原生 runner 验证；不同 Grok Build CLI 版本的真实 ACP 工作流仍属于 Alpha 兼容性测试范围。

## [0.1.0-alpha.1] - 2026-07-20

### Added

- Electron + React + TypeScript 桌面应用基础。
- 中文三栏工作台与原创星轨视觉。
- 工作区选择、Git 状态、会话列表和本地界面持久化。
- Grok Build ACP 启动、认证复用、会话创建、提示、取消和模式桥接。
- 回复、过程、工具、计划、用量与完成状态事件归一化。
- ACP 权限确认弹窗和工具详情展示。
- 并发权限请求队列、ACP 断线重建与重复工作区 ID 复用。
- 命令面板、设置/关于、演示会话和紧凑窗口布局。
- 状态归一化测试、ACP 冒烟脚本和 macOS arm64 打包配置。

### Security

- 渲染进程启用 `contextIsolation`、关闭 Node 集成并使用沙箱。
- IPC 只接受主窗口主 frame 的固定能力调用；Git 命令使用 `execFile`，不经过 shell。
- 工作区路径在主进程解析并验证为真实目录。
- 界面层不读取或保存 xAI API 密钥；CLI 子进程按应用启动环境继承变量。
- 内容安全策略限制脚本、图片和网络连接来源；持久化历史会裁剪并移除工具载荷。

[Unreleased]: https://github.com/aidong27/orbit-workbench/compare/v0.2.0-alpha.3...HEAD
[0.2.0-alpha.3]: https://github.com/aidong27/orbit-workbench/compare/v0.2.0-alpha.2...v0.2.0-alpha.3
[0.2.0-alpha.2]: https://github.com/aidong27/orbit-workbench/compare/v0.2.0-alpha.1...v0.2.0-alpha.2
[0.2.0-alpha.1]: https://github.com/aidong27/orbit-workbench/compare/v0.1.0-alpha.1...v0.2.0-alpha.1
[0.1.0-alpha.1]: https://github.com/aidong27/orbit-workbench/releases/tag/v0.1.0-alpha.1
