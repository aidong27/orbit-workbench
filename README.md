# 星轨工作台

星轨工作台是一款独立开发的、非官方的 **Grok Build 中文图形客户端**。它采用类似现代编码代理桌面应用的三栏工作流，但使用 GrokNight 风格的深灰与洋红视觉，并通过官方支持的 Agent Client Protocol（ACP）连接用户本机的 `grok` 进程。

> 当前版本：`0.1.0-alpha.1` 私有预览。仓库暂不公开，也没有发布许可证；待人工检查通过后再决定开源许可证和正式名称。

## 当前已经可以做什么

- 选择本地项目并显示 Git 分支、未提交文件和差异统计。
- 创建多个中文任务会话，并在本地保存界面状态。
- 通过 `grok agent stdio` 建立真实 ACP 会话。
- 流式显示 Grok 回复、过程摘要、执行计划与工具调用。
- 在敏感工具调用前显示 ACP 权限确认弹窗。
- 停止正在运行的任务；在原生模式可用时切换会话模式。
- 当 Grok ACP 暂未暴露模式列表时，用 `/plan` 兼容计划模式。
- 提供变更、计划、工具、上下文四个检查器标签页。
- 支持 `⌘K` 命令面板、`⌘N` 新建任务和 `⌘,` 设置。
- 首次打开自带明确标注的界面演示数据，便于检查布局，不会伪装成真实执行结果。

## 安全边界

星轨工作台不会读取或保存 `XAI_API_KEY`，也不会解析 Grok 的认证文件。认证、模型请求、工具执行和会话存储均由用户已经安装的官方 Grok Build CLI 负责。

```text
React 界面
   │ 受限 IPC
Electron 主进程
   │ ACP / JSON-RPC over stdio
本机 grok agent stdio
   │
Grok Build 的认证、工具、会话与权限策略
```

客户端不捆绑上游 Grok Build 二进制；默认查找 `~/.grok/bin/grok`，也可以通过 `GROK_BINARY` 指定其他绝对路径。

## 本地运行

前置条件：

- macOS（首个检查版本）。
- Node.js `24.18.0`。
- pnpm `11.12.0`。
- 已安装并登录 Grok Build：

```bash
grok --version
grok login
```

安装依赖并启动：

```bash
pnpm install
pnpm dev
```

首次安装如果 Electron 二进制没有下载，可执行：

```bash
pnpm rebuild electron
```

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:acp
```

完整检查：

```bash
pnpm check
```

构建未签名的 macOS 检查包：

```bash
pnpm package:dir
```

## 目录结构

```text
src/main/        Electron 主进程、工作区检查与 Grok ACP 管理器
src/preload/     最小权限的 IPC 桥接
src/renderer/    React 中文 GUI、状态归一化和组件测试
src/shared/      主进程与渲染进程共享类型
scripts/         本机 ACP 冒烟测试
docs/            架构、验收和开源前检查资料
build/           原创应用图标与打包资源
```

## 版本管理

- 遵循语义化版本，预览阶段使用 `0.1.0-alpha.N`。
- `main` 保存稳定检查点；功能通过短期分支和 Draft PR 审阅。
- 提交信息采用 Conventional Commits。
- 第一个私有检查标签为 `v0.1.0-alpha.1`。
- 用户确认后，才会添加开源许可证、创建公开 Release 或改变仓库可见性。

详细说明见 [架构文档](docs/ARCHITECTURE.md) 和 [人工验收清单](docs/REVIEW_CHECKLIST.md)。

## 非官方声明

本项目与 xAI 没有隶属、授权或背书关系。“Grok”和“Grok Build”仅用于说明兼容对象。应用名称、轨道图形和界面视觉均为本项目原创；没有复制或修改 xAI/Grok 官方 Logo。
