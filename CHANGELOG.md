<!-- markdownlint-disable MD024 -->

# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- Windows 与 macOS 正式代码签名。
- 自动更新与可验证的发布来源。
- Linux 支持评估。

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

[Unreleased]: https://github.com/aidong27/orbit-workbench/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/aidong27/orbit-workbench/compare/v0.1.0-alpha.1...v0.2.0-alpha.1
[0.1.0-alpha.1]: https://github.com/aidong27/orbit-workbench/releases/tag/v0.1.0-alpha.1
