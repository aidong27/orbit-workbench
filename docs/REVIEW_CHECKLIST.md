# 跨平台公开预览检查清单

本清单用于 `0.2.0-alpha.1` 及后续公开预览。只有代码、安装包、文档和仓库设置同时通过，才应创建公开 Release。

## 通用代码质量

- [ ] `pnpm install --frozen-lockfile` 在干净环境成功。
- [ ] `pnpm check` 完成类型检查、lint、测试和生产构建。
- [ ] 依赖漏洞与许可证检查已复核。
- [ ] 完整 Git 历史秘密扫描无密钥、令牌、认证文件或私人路径。
- [ ] CI 使用固定主版本/版本号，最小 `permissions` 为只读。
- [ ] 仓库没有提交 `release/`、`out/`、真实会话或私有项目内容。

## Windows x64

- [ ] 在 GitHub 托管的 Windows runner 上完成 `pnpm dist:win`。
- [ ] 生成 NSIS Setup 和 Portable 两个 `.exe`。
- [ ] 安装路径可选择，桌面/开始菜单快捷方式名称正确。
- [ ] Portable 版本不要求安装并能独立启动。
- [ ] 能从默认目录和 `PATH` 找到 `grok.exe`。
- [ ] `GROK_BINARY` 指向有效绝对路径时可覆盖自动检测。
- [ ] 无效、非 `.exe` 或不存在的路径显示可操作中文错误。
- [ ] 受控退出后，`taskkill /t /f` 对应的 Grok ACP 进程树不再运行。
- [ ] 窗口、中文、快捷键和系统目录选择器显示正确。

## macOS arm64

- [ ] 在 Apple Silicon runner/机器上完成 `pnpm dist:mac`。
- [ ] 生成 DMG 和 ZIP。
- [ ] 应用图标、产品名和 Bundle ID 正确。
- [ ] 能从 `~/.grok/bin/grok`、`PATH` 和 `GROK_BINARY` 找到 CLI。
- [ ] 关闭窗口后 ACP 子进程退出。
- [ ] 1024×768 与 1500×960 下没有横向溢出或中文遮挡。

## 真实 ACP 工作流

- [ ] `pnpm smoke:acp` 完成握手、认证复用和新建 session。
- [ ] 新建任务后回复可以流式出现。
- [ ] 工具卡从执行中进入完成、失败或取消状态。
- [ ] 原生计划模式与 `/plan` 兼容模式行为清晰。
- [ ] 停止按钮能取消当前任务。
- [ ] 并发权限请求按顺序展示且不会串到错误 session。
- [ ] 拒绝或取消权限后，任务不会被界面静默继续批准。
- [ ] CLI 断线后旧 Session ID 不被复用，重新连接可恢复。

## 安全与隐私

- [ ] `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`。
- [ ] preload 未暴露通用 `ipcRenderer`、shell 或文件系统接口。
- [ ] IPC 只接受主窗口主 frame，且参数在主进程验证。
- [ ] Git 与进程调用不经过 shell 字符串拼接。
- [ ] 外部链接仅允许受支持协议并在系统浏览器打开。
- [ ] Markdown 中的 HTML、脚本和危险 URL 无法执行。
- [ ] 本地恢复数据不包含 ACP Session ID、权限请求或工具原始载荷。
- [ ] 安装包不包含 `XAI_API_KEY`、开发机路径或 CLI 认证文件。

## 文档与品牌

- [ ] 产品统一称为“星轨工作台 / Orbit Workbench”。
- [ ] README 首屏包含非官方声明和真实平台支持范围。
- [ ] 没有把 Grok/xAI 用作应用标题、自有标志或暗示官方背书。
- [ ] 未使用或修改 xAI/Grok 官方 Logo。
- [ ] 截图使用虚构项目、路径和对话，不含用户数据。
- [ ] `LICENSE`、`SECURITY.md`、贡献指南、行为准则和第三方声明齐全。
- [ ] 中英文 README 的版本号、下载链接与安全警告一致。

## GitHub 仓库

- [ ] 仓库已重命名为 `aidong27/orbit-workbench`，旧链接有重定向。
- [ ] 完整项目已经合并到 `main`，不是只存在于功能分支。
- [ ] About 描述、topics、许可证和 Social Preview 正确显示。
- [ ] Issue Forms 与 PR 模板可用。
- [ ] CI 为必需检查，禁止强制推送和删除 `main`。
- [ ] Secret scanning、Dependabot 和 Private Vulnerability Reporting 已启用。
- [ ] 空置 Projects/Wiki 已关闭或已有明确维护用途。

## Release

- [ ] `v0.2.0-alpha.1` 标签指向通过检查的 `main` 提交。
- [ ] Release 标记为 Pre-release，并包含 Windows/macOS 产物。
- [ ] 文件名、架构和版本与 `package.json` 一致。
- [ ] 每个产物有 SHA-256 校验值。
- [ ] Release notes 包含已知限制与“未签名/未公证”警告。
- [ ] 从 Release 页面重新下载并验证至少一个 Windows 和一个 macOS 产物。
- [ ] 公开后从未登录浏览器检查 README 图片、徽章、链接和许可证识别。
