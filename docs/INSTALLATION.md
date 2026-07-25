<!-- markdownlint-disable MD013 -->

# 安装与故障排查 / Installation and Troubleshooting

本指南对应星轨工作台源码版本 `0.2.0-alpha.4`：Windows x64 与 macOS arm64。可下载版本与最新公开标签以仓库 Releases 页面为准。

> [!WARNING]
> 当前 Alpha 包尚未进行 Windows Authenticode 签名；macOS 包也尚未进行 Apple Developer ID 签名或公证。请只从 `aidong27/orbit-workbench` 的 Releases 获取文件并核对校验值。不要从网盘、聊天附件或第三方镜像运行安装包。

## 前置：Grok Build CLI

星轨工作台不是模型客户端，也不包含 Grok Build CLI。请先按 [xAI 官方 Grok Build 文档](https://docs.x.ai/build/overview)安装、登录并验证：

```bash
grok --version
grok login
```

应用只会启动用户本机的 CLI，并通过 `grok --no-auto-update agent stdio` 建立 ACP 连接。

## Windows x64

在 PowerShell 中，xAI 官方文档提供以下安装命令：

```powershell
irm https://x.ai/cli/install.ps1 | iex
```

这条管道会下载后立即执行远程脚本。希望先检查内容时，请先单独打开 `https://x.ai/cli/install.ps1` 审阅，再决定是否运行。星轨工作台只展示和复制命令，不会自动执行脚本；默认安装位置是 `$env:USERPROFILE\.grok\bin\grok.exe`。

### 安装版

仅当 Releases 页面已经列出 `v0.2.0-alpha.4` 时下载：

```text
Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Setup.exe
```

安装器是 Unicode 的交互式 NSIS 安装包，允许选择安装目录，并会创建“星轨工作台”桌面与开始菜单快捷方式。安装目录可以包含空格和中文；项目的 Windows CI 会在此类路径中完成静默安装、启动和卸载验证。

当前 Alpha 安装器没有 Authenticode 签名，Windows SmartScreen 可能显示“未知发布者”。这不代表校验值可以省略，也不建议关闭 SmartScreen：请确认下载来源是本仓库 Release，并先核对 `SHA256SUMS-Windows-x64.txt`。无法确认来源时不要运行。

### 便携版

仅当 Releases 页面已经列出 `v0.2.0-alpha.4` 时下载：

```text
Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Portable.exe
```

便携版无需安装应用本身，不创建卸载项或快捷方式，可以从含空格和中文的目录启动，但仍需要本机已经存在可执行的 `grok.exe`。

“便携”只描述应用程序的分发方式，不代表完全无状态。会话标题、工作区路径和裁剪后的本地界面历史仍使用 Electron 用户数据目录保存；删除 Portable `.exe` 不会自动删除这些数据。

### 安装内容与卸载

安装完成后，安装目录应包含：

- `Orbit Workbench.exe`；
- `resources/app.asar`；
- `resources/LICENSE.txt`；
- `resources/THIRD_PARTY_NOTICES.md`；
- `resources/THIRD_PARTY_LICENSES.txt`；
- `resources/THIRD_PARTY_LICENSES.chromium.html`；
- 一个 `Uninstall*.exe` 卸载程序。

推荐从 Windows“设置 → 应用 → 已安装的应用 → 星轨工作台”卸载。卸载会移除程序文件、桌面/开始菜单快捷方式和卸载注册项，但默认保留用户数据与本地历史，避免升级或误卸载造成记录丢失。若要清理历史，请先按本文“清理本地界面历史”确认准确目录，不要使用针对用户目录的宽泛递归删除命令。

卸载前请先正常退出星轨工作台。若 Windows 报告文件正在使用，可在任务管理器确认 `Orbit Workbench.exe` 已退出后重试；不要在 Grok 任务仍运行时直接删除安装目录。

### CLI 检测

应用依次检查：

1. 环境变量 `GROK_BINARY`；
2. 环境变量 `GROK_BIN_DIR` 下的 `grok.exe`；
3. `%USERPROFILE%\.grok\bin\grok.exe`；
4. `PATH` 中每个绝对目录下的 `grok.exe`。

只接受以 `.exe` 结尾的绝对文件路径，不执行 `.cmd`/`.bat` 包装器，也不通过 `PATH` 解析 `where.exe`。若希望把官方 CLI 安装到自定义目录，可在执行安装脚本前设置 `GROK_BIN_DIR`；若要直接指定某一个现有文件，则使用 `GROK_BINARY`。

临时设置示例（PowerShell）：

```powershell
$env:GROK_BINARY = 'C:\完整\路径\grok.exe'
& '.\Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Portable.exe'
```

持久环境变量设置后需要重新启动应用，使新进程读取到更新后的值。

## macOS arm64

下载 DMG 或 ZIP：

```text
Orbit-Workbench-0.2.0-alpha.4-macOS-arm64.dmg
Orbit-Workbench-0.2.0-alpha.4-macOS-arm64.zip
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
Get-FileHash '.\Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Setup.exe' -Algorithm SHA256
Get-FileHash '.\Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Portable.exe' -Algorithm SHA256
Get-Content '.\SHA256SUMS-Windows-x64.txt'
```

Windows CMD：

```bat
certutil -hashfile Orbit-Workbench-0.2.0-alpha.4-Windows-x64-Setup.exe SHA256
```

macOS：

```bash
shasum -a 256 Orbit-Workbench-0.2.0-alpha.4-macOS-arm64.dmg
shasum -a 256 Orbit-Workbench-0.2.0-alpha.4-macOS-arm64.zip
cat SHA256SUMS-macOS-arm64.txt
```

如果校验值不一致，请删除文件并提交不包含该文件内容的安全报告。

校验清单中的每个文件名必须与下载文件完全一致，哈希应为 64 位十六进制字符串。Windows CI 只为严格匹配当前版本和 `x64` 架构的 Setup、Portable 两个产物生成 `SHA256SUMS-Windows-x64.txt`，并在上传前重新读取清单验证；macOS 构建对应生成 `SHA256SUMS-macOS-arm64.txt`。

## 常见问题

### 显示“未找到 Grok Build”

- 在同一用户账户的终端运行 `grok --version`；
- Windows 确认文件实际名为 `grok.exe`；
- 检查 `GROK_BINARY` 是否为绝对文件路径、`GROK_BIN_DIR` 是否为绝对目录，且没有不成对的引号；
- 从图形界面启动时，不能假设它拥有终端的完整 `PATH`。

### CLI 可以运行，但 ACP 连接失败

- 先退出其他可能占用或更新 CLI 的进程；
- 直接运行 `grok --version` 确认安装没有损坏；
- 确认已经完成 `grok login`；
- 在源码 checkout 中运行 `pnpm smoke:acp` 获取脱敏诊断。

### 系统提示来源未知

Alpha 包缺少 Authenticode、Apple Developer ID 签名或公证时，Windows SmartScreen 和 macOS Gatekeeper 可能显示来源提示。先核对仓库 URL、Release 标签和 SHA-256。项目不建议在来源无法确认时关闭系统安全功能；可以从源码构建或等待签名版本。

### Windows 安装或卸载失败

- 确认 Setup 文件名、版本和 `Windows-x64` 架构与 Release 页面一致；
- 将安装器复制到普通本地目录后重试，避免从压缩包内部或网络共享直接运行；
- 先退出正在运行的星轨工作台，再通过“已安装的应用”卸载；
- 如果卸载项存在但路径失效，不要从网络下载所谓“专用卸载工具”；请记录安装路径、版本和错误信息后提交 Issue；
- 提交问题时可附安装器退出代码、Windows 版本、安装路径是否包含中文/空格，以及脱敏后的截图；不要上传账号名、CLI 认证文件或完整用户目录。

### 清理本地界面历史

星轨工作台使用 Electron 的用户数据目录保存带版本号的 v3 界面状态，包括工作区路径、会话标题和裁剪后的时间线。重启后这些记录只作为“仅本地历史”显示，不代表代理上下文已恢复。删除前先退出应用，并确认不再需要本地标题与文本。由于不同系统目录不同，项目不会在文档中提供宽泛的递归删除命令；可以通过系统应用数据管理或开发者工具定位准确目录。

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

Install and authenticate Grok Build CLI first. Download Orbit Workbench only when the matching tag is present on this repository's Releases, verify SHA-256, and select the Windows x64 or macOS arm64 artifact. On Windows, the app checks `GROK_BINARY`, `GROK_BIN_DIR`, the official user-profile location, and absolute `PATH` directories for an absolute file path ending in `.exe`; on macOS, `GROK_BINARY` must point to an executable absolute path. Current Alpha packages are not Authenticode- or Developer ID-signed, and macOS packages are not notarized.
