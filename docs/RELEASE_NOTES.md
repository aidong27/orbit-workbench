<!-- markdownlint-disable MD013 -->

# Orbit Workbench 0.2.0-alpha.4 开发快照说明

> 这是源码开发快照的说明，不代表同版本安装包已经公开发布。可下载版本只以仓库 Releases 页面实际列出的标签和文件为准。

`0.2.0-alpha.4` 是一次 Windows 可靠性、连接引导与高缩放可用性升级。它不扩张表面功能，重点保证 CLI 能被安全找到、窗口和文字在常见 Windows 显示设置下可用、安装包生命周期能被真实验证，并让复制出的诊断与权限来源保持可信。

## 重点变化

- **缺少 Grok 时不再只报错**：Windows 欢迎页和连接中心展示 xAI 官方 PowerShell 安装命令、默认路径、官方文档与脚本审阅入口。命令只能复制，应用不会自动执行。
- **CLI 查找更可靠**：依次检查 `GROK_BINARY`、官方 `GROK_BIN_DIR`、用户默认目录和 `PATH` 中的绝对目录；只接受以 `.exe` 结尾的绝对文件路径，不执行 `.cmd`/`.bat`，也不再调用可被 `PATH` 替换的 `where.exe`。
- **Windows 退出既温和又可证明**：正常关闭时先结束 ACP stdin 并等待 1.5 秒；Grok 会在挂起状态下加入带 `KILL_ON_JOB_CLOSE` 的 Windows Job Object 后才运行，监督器也监控 Electron 父进程。直接代理先崩溃、应用退出或监督器被终止时，Windows 会收敛剩余后代；`%SystemRoot%\System32\taskkill.exe` 只作为超时兜底。
- **高 DPI 与窄视口可用**：初始窗口按实际工作区收敛，Windows 最低尺寸降至 760×560；Segoe UI/Cascadia 字体、13px 滚动条、最低 12px 辅助文字、单列引导、长路径换行、弹窗滚动和强制高对比度模式得到专项适配。
- **连接状态不再互相矛盾**：CLI 缺失时顶部栏、侧栏和连接中心统一显示“未安装”；设置弹窗默认停留在状态摘要顶部，不再自动滚动到下方重试区。
- **模态与断连状态收敛**：设置、命令面板和权限确认会独占键盘焦点；权限来源切换不会把焦点送到弹窗背后。ACP 断连会终结流式文字和未完成工具，不再同时显示“失败”和执行中动画。
- **键盘与输入法更稳**：AltGr 不再误触 Ctrl 快捷键；IME 组词中的 Enter 不执行命令；命令面板、设置和模式菜单补齐焦点闭环、方向键、Home/End、Escape 与焦点恢复。
- **工作区身份一致**：盘符大小写、正反斜杠、UNC 与扩展路径形式会归一为同一个 Windows 工作区；reducer 会合并历史重复项并重映射会话，权限来源也按同一规则核验。
- **诊断复制真正脱敏**：CLI 路径、版本、Agent 元数据和错误详情统一移除用户目录、常见凭据、URL 认证信息与控制字符，并设置字段上限；本地界面仍可显示原始本机路径。
- **Git 路径不再靠文本切片**：改用 `git status --porcelain=v1 -z`，正确处理空格、引号、Unicode、控制字符与重命名/复制记录。

## Windows 安装包验证

- 构建配置固定为 x64 Unicode NSIS Setup 与 Portable，并显式保留卸载后的用户数据。
- Windows runner 会在含空格和中文的目录完成安装、启动、快捷方式、精确卸载注册项、卸载、安装目录清理和重命名 Portable 启动。
- Windows runner 会执行安装包内的 Job Object 监督器，验证 ACP stdio 字节不变，并证明直接子进程退出后仍存活的后代会被清理；同时核验原生文件的固定 SHA-256 与 PE32+ x64 头。
- 安装版通过应用只读 smoke 输出定位真实 `app.getPath('userData')`，用单个随机 sentinel 验证卸载保留本地数据；无论成功或失败，脚本只清理该测试文件。
- 进程检查以测试开始前的 PID 为基线，绝不终止原有进程；仅跟踪和处置本轮新建的进程树。
- `release/` 根目录只允许当前版本的 Setup 与 Portable 两个 `.exe`，上传使用从 `package.json` 动态生成的精确路径，并重新读取验证 SHA-256 清单。
- 构建日志会始终尝试上传；验证诊断可在验证成功或验证脚本内普通步骤失败时下载。checkout、依赖安装、runner 丢失、任务取消或超时不承诺生成完整诊断。

## 工程与依赖

- Electron 升级到 43.2.0，React/React DOM 升级到 19.2.8，Biome 升级到 2.5.5。
- `@types/node` 回到 24.x，与项目声明的 Node 24.18 运行时一致。
- `pnpm audit --prod` 无已知漏洞；electron-builder 传递树中可在原主版本内安全升级的 `fast-uri`、`tar` 和 `brace-expansion` 已锁定到修复补丁。
- 完整检查现在同时执行 TypeScript、Biome、Vitest、脚本层 `node:test`、许可证一致性、Windows 配置契约和 Electron/Vite 生产构建。
- `smoke:acp` 与正式应用使用一致的 Windows CLI 发现、最小环境和退出策略；脚本测试会与生产 TypeScript helper 做 parity 比对。

## 升级说明

- v1/v2 本地界面数据仍自动迁移到 v3；迁移不会恢复旧 ACP Session ID。
- 已保存且含时间线的会话继续标记为“仅本地历史”，不会伪装成已恢复代理上下文。
- 升级不会主动删除真实工作区、会话历史或 Electron 用户数据；NSIS 标准卸载也默认保留这些数据。
- 若此前通过 `GROK_BINARY` 指定 CLI，可继续使用；官方自定义安装目录也可使用 `GROK_BIN_DIR`。

## 已知限制

- Windows 安装包尚未进行 Authenticode 签名；macOS 包尚未进行 Apple Developer ID 签名或公证，hardened runtime 也尚未启用。Windows CI 明确关闭证书自动发现，生命周期验证不等于发布者身份认证。
- 完整依赖审计仍会报告 electron-builder 内旧版 minimatch 所需的 `brace-expansion` 开发依赖；上游尚无兼容旧主版本的修复发布。生产依赖不受影响，项目没有用不兼容的 5.x 强行替换 1.x/2.x。
- Windows 的真实物理设备、多显示器、辅助技术和更多缩放组合仍需要持续验证。
- 仍不支持从 Grok Build 上游会话库恢复完整代理上下文。
- 当前仍是 Alpha。请优先在有版本控制、可回滚的工作区测试。

完整改动见 [CHANGELOG.md](../CHANGELOG.md)，安装与来源验证见[安装指南](INSTALLATION.md)。
