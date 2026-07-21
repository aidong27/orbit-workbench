<!-- markdownlint-disable MD013 -->

# 安装与故障排查 / Installation and Troubleshooting

本指南适用于星轨工作台 `0.2.0-alpha.2`：Windows x64 与 macOS arm64。

> [!WARNING]
> 当前 Alpha 包尚未进行 Windows 代码签名或 Apple Developer ID 公证。请只从 `aidong27/orbit-workbench` 的 Releases 获取文件并核对校验值。不要从网盘、聊天附件或第三方镜像运行安装包。

## 前置：Grok Build CLI

星轨工作台不是模型客户端，也不包含 Grok Build CLI。请先按[上游项目](https://github.com/xai-org/grok-build)说明安装、登录并验证：

```bash
grok --version
grok login
```

应用只会启动用户本机的 CLI，并通过 `grok --no-auto-update agent stdio` 建立 ACP 连接。

## Windows x64

### 安装版

下载：

```text
Orbit-Workbench-0.2.0-alpha.2-Windows-x64-Setup.exe
```

安装器允许选择安装目录，并可创建桌面与开始菜单快捷方式。

### 便携版

下载：

```text
Orbit-Workbench-0.2.0-alpha.2-Windows-x64-Portable.exe
```

便携版无需安装应用本身，但仍需要本机已经存在可执行的 `grok.exe`。

### CLI 检测

应用依次检查：

1. 环境变量 `GROK_BINARY`；
2. `%USERPROFILE%\.grok\bin\grok.exe`；
3. `PATH` 中 `where.exe grok.exe` 的首个结果。

临时设置示例（PowerShell）：

```powershell
$env:GROK_BINARY = 'C:\完整\路径\grok.exe'
& '.\Orbit-Workbench-0.2.0-alpha.2-Windows-x64-Portable.exe'
```

持久环境变量设置后需要重新启动应用，使新进程读取到更新后的值。

## macOS arm64

下载 DMG 或 ZIP：

```text
Orbit-Workbench-0.2.0-alpha.2-macOS-arm64.dmg
Orbit-Workbench-0.2.0-alpha.2-macOS-arm64.zip
```

DMG：打开后将“星轨工作台”拖到 Applications。ZIP：解压后将应用移动到 Applications。

CLI 检测顺序：

1. 环境变量 `GROK_BINARY`；
2. `~/.grok/bin/grok`；
3. 当前应用进程 `PATH` 中的 `grok`。

从 Finder 启动的应用不一定继承交互式 shell 的完整 `PATH`。如果 CLI 装在其他位置，优先使用 `GROK_BINARY` 指定绝对路径。

## 校验下载文件

发布页应提供每个文件的 SHA-256。将命令输出与发布页逐字符比较。

Windows PowerShell：

```powershell
Get-FileHash '.\Orbit-Workbench-0.2.0-alpha.2-Windows-x64-Setup.exe' -Algorithm SHA256
```

Windows CMD：

```bat
certutil -hashfile Orbit-Workbench-0.2.0-alpha.2-Windows-x64-Setup.exe SHA256
```

macOS：

```bash
shasum -a 256 Orbit-Workbench-0.2.0-alpha.2-macOS-arm64.dmg
```

如果校验值不一致，请删除文件并提交不包含该文件内容的安全报告。

## 常见问题

### 显示“未找到 Grok Build”

- 在同一用户账户的终端运行 `grok --version`；
- Windows 确认文件实际名为 `grok.exe`；
- 检查 `GROK_BINARY` 是否为绝对路径且没有多余引号；
- 从图形界面启动时，不能假设它拥有终端的完整 `PATH`。

### CLI 可以运行，但 ACP 连接失败

- 先退出其他可能占用或更新 CLI 的进程；
- 直接运行 `grok --version` 确认安装没有损坏；
- 确认已经完成 `grok login`；
- 在源码 checkout 中运行 `pnpm smoke:acp` 获取脱敏诊断。

### 系统提示来源未知

Alpha 包未签名或公证时，Windows SmartScreen 和 macOS Gatekeeper 可能显示来源提示。先核对仓库 URL、Release 标签和 SHA-256。项目不建议在来源无法确认时关闭系统安全功能；可以从源码构建等待签名版本。

### 清理本地界面历史

星轨工作台使用 Electron 的用户数据目录保存带版本号的 v2 界面状态，包括工作区路径、会话标题和裁剪后的时间线。重启后这些记录只作为“仅本地历史”显示，不代表代理上下文已恢复。删除前先退出应用，并确认不再需要本地标题与文本。由于不同系统目录不同，项目不会在文档中提供宽泛的递归删除命令；可以通过系统应用数据管理或开发者工具定位准确目录。

## 从源码构建

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

随后在目标系统运行对应命令：

```bash
pnpm dist:win
pnpm dist:mac
```

不要把在一个平台生成的未验证包当作另一个平台的正式测试结果。发布前请执行[跨平台检查清单](REVIEW_CHECKLIST.md)。

## English quick reference

Install and authenticate Grok Build CLI first. Download only from the official repository Releases, verify SHA-256, and select the Windows x64 or macOS arm64 artifact. On Windows, `GROK_BINARY` must point to `grok.exe`; on macOS, it must point to an executable absolute path. Current Alpha packages are unsigned.
