# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 与语义化版本。

## [0.1.0-alpha.1] - 2026-07-20

### Added

- Electron + React + TypeScript 桌面应用基础。
- GrokNight 风格中文三栏工作台与原创星轨标志。
- 工作区选择、Git 状态、会话列表和本地界面持久化。
- Grok Build ACP 启动、认证复用、会话创建、提示、取消和模式桥接。
- 回复、过程、工具、计划、用量与完成状态事件归一化。
- ACP 权限确认弹窗和工具详情展示。
- 命令面板、设置/关于、演示会话和紧凑窗口布局。
- 状态归一化测试、ACP 冒烟脚本和 macOS 打包配置。

### Security

- 渲染进程启用 `contextIsolation`、关闭 Node 集成并使用沙箱。
- IPC 只暴露固定能力；Git 命令使用 `execFile`，不经过 shell。
- 工作区路径在主进程解析并验证为真实目录。
- 不读取、不传递、不保存 xAI API 密钥。
