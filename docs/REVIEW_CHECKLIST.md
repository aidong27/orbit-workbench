# 跨平台公开预览检查清单

本清单用于 `0.2.x` Alpha 及后续公开预览。只有代码、安装包、文档和仓库设置同时通过，才应创建公开 Release。

## 通用代码质量

- [ ] `pnpm install --frozen-lockfile` 在干净环境成功。
- [ ] `pnpm check` 完成类型检查、lint、测试和生产构建。
- [ ] 依赖漏洞与许可证检查已复核。
- [ ] 完整 Git 历史秘密扫描无密钥、令牌、认证文件或私人路径。
- [ ] GitHub Actions 固定到完整 commit SHA，Node/pnpm 版本受控，最小 `permissions` 为只读。
- [ ] 仓库没有提交 `release/`、`out/`、真实会话或私有项目内容。

## Windows x64

- [ ] 在 GitHub 托管的 Windows runner 上完成 `pnpm dist:win`。
- [ ] 严格生成与 `package.json` 版本一致的 NSIS Setup 和 Portable 两个 x64 `.exe`，`release/` 根目录没有任何其他 `.exe`。
- [ ] `pnpm windows:config:check` 验证 Unicode、辅助安装、稳定产物名、快捷方式和保留用户数据策略。
- [ ] unpacked 应用、NSIS 安装后应用与重命名后的 Portable 均完成真实 renderer/preload 启动。
- [ ] NSIS 能静默安装到同时包含空格与中文的路径；安装后产品名、ProductVersion、主程序和 `app.asar` 正确。
- [ ] 安装后的完整许可证、Chromium notices 和第三方声明均存在且非空。
- [ ] 仅按当前测试安装目录定位唯一卸载注册项，显示版本精确匹配，UninstallString 精确指向本轮卸载程序，不受旧安装项影响。
- [ ] 桌面/开始菜单快捷方式存在、中文名称正确并指向当前安装目录。
- [ ] 静默卸载后整个安装目录、两个精确路径的快捷方式和本轮卸载注册 key 消失；由应用报告的 `app.getPath('userData')` sentinel 仍保留。
- [ ] Portable 版本从含空格与中文的重命名路径启动，不创建对应卸载注册项或任何新快捷方式。
- [ ] Setup、安装版、Portable 和卸载流程只检查并处置本轮新建进程；测试开始前已存在的 PID 绝不终止。
- [ ] 安装包内 `windows-job-runner.exe` 的 SHA-256、PE32+ x64 头与源码记录一致。
- [ ] 原生 Windows 门禁证明 Job Object 监督器逐字节保留 stdio，并在直接子进程先退出后清理仍存活的后代。
- [ ] `SHA256SUMS-Windows-x64.txt` 仅包含当前版本 Setup/Portable，清单被重新读取并验证。
- [ ] Windows 构建日志始终尝试上传；验证诊断可在验证成功或验证脚本内普通步骤失败时下载。checkout、依赖安装、构建中断、runner 丢失或任务取消不承诺完整诊断。
- [ ] 能从默认目录和 `PATH` 找到 `grok.exe`。
- [ ] `GROK_BINARY` 指向有效绝对路径时可覆盖自动检测。
- [ ] 无效、非 `.exe` 或不存在的路径显示可操作中文错误。
- [ ] Grok 在 `CREATE_SUSPENDED` 状态加入 kill-on-close Job Object 后才运行；受控退出先关闭 ACP stdin，宽限期后才通过 System32 中 `taskkill /t /f` 的绝对路径结束监督器。
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
- [ ] items、Markdown 与 file 三种 `plan_update` 均能正确显示或替换。
- [ ] 同一 `messageId` 的分片正确归并，不同消息交错时不会误合并。
- [ ] 原生计划模式与 `/plan` 兼容模式行为清晰；切换失败时 UI 保留服务端已确认模式。
- [ ] 停止按钮能取消当前任务。
- [ ] 取消或通道失效后，prompt 状态在有限时间内收敛或重建连接。
- [ ] 并发权限请求按顺序展示且不会串到错误 session；弹窗显示工作区、路径和会话来源。
- [ ] 超大、深层和多字段权限载荷经过限长或安全拒绝，不会阻塞 renderer。
- [ ] 拒绝或取消权限后，任务不会被界面静默继续批准。
- [ ] CLI 断线后旧 Session ID 不被复用，重新连接可恢复。
- [ ] 中文输入法组词时 Enter 不会误发送；不同会话的草稿不会串线。

## 安全与隐私

- [ ] `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`。
- [ ] preload 未暴露通用 `ipcRenderer`、shell 或文件系统接口。
- [ ] IPC 只接受主窗口主 frame，且参数在主进程验证。
- [ ] Git 与进程调用不经过 shell 字符串拼接。
- [ ] 外部链接仅允许受支持协议并在系统浏览器打开。
- [ ] Markdown 中的 HTML、脚本和危险 URL 无法执行。
- [ ] 本地恢复数据不包含 ACP Session ID、权限请求或工具原始载荷。
- [ ] 恢复的旧时间线标记为“仅本地历史”，不能在原视觉会话下静默新建 ACP session。
- [ ] v1/v2/v3 数据迁移到 v4 后通过 schema 校验，失效项目/会话与孤立草稿引用得到修复。
- [ ] Grok 子进程只继承环境白名单，Node/Electron 注入变量始终被拒绝。
- [ ] ACP NDJSON 单帧上限、诊断脱敏和 Electron fuses 在打包产物中验证通过。
- [ ] `pnpm licenses:check` 通过，完整第三方许可证正文与 Chromium notices 已进入最终安装包。
- [ ] 浏览器权限请求默认拒绝，应用只使用明确实现的桌面能力。
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

- [ ] 准备发布的 `v<package.json version>` 标签指向通过检查的 `main` 提交。
- [ ] Release 标记为 Pre-release，并包含 Windows/macOS 产物。
- [ ] 文件名、架构和版本与 `package.json` 一致。
- [ ] 每个产物有 SHA-256 校验值。
- [ ] Release notes 包含已知限制与“未签名/未公证”警告。
- [ ] 从 Release 页面重新下载并验证至少一个 Windows 和一个 macOS 产物。
- [ ] 公开后从未登录浏览器检查 README 图片、徽章、链接和许可证识别。
