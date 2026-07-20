<!-- markdownlint-disable MD013 -->

# 贡献指南 / Contributing

感谢你帮助完善星轨工作台。项目当前处于 Alpha 阶段，最有价值的贡献是可复现的跨平台问题、聚焦的安全改进和能够保持本地优先边界的小型功能。

参与前请遵守[行为准则](CODE_OF_CONDUCT.md)。提交代码即表示你同意贡献内容按本项目的 [Apache License 2.0](LICENSE) 发布。

## 从哪里开始

- 使用 Bug Issue Form 报告可以稳定复现的问题。
- 使用 Feature Request Form 描述用户场景，而不仅是期望的实现。
- 安全漏洞必须按[安全政策](SECURITY.md)私密报告。
- 大型架构调整请先开 Issue，避免双方投入到方向不同的实现。

## 开发环境

需要：

- Node.js `24.18.0`
- pnpm `11.12.0`
- Windows x64 或 macOS arm64
- 已安装并登录的 Grok Build CLI（只有 ACP 冒烟测试需要）

```bash
git clone https://github.com/aidong27/orbit-workbench.git
cd orbit-workbench
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

## 分支与提交

- 从最新 `main` 创建短期分支，例如 `feat/windows-tray` 或 `fix/acp-timeout`。
- 提交信息采用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`test:`、`chore:`。
- 一个 Pull Request 只解决一个清晰问题；不要混入无关格式化或依赖升级。
- 不要提交 API 密钥、认证文件、真实私有项目内容、绝对用户路径或构建产物。

## 提交前检查

```bash
pnpm check
```

涉及 ACP 连接时，在可回滚的测试目录额外运行：

```bash
pnpm smoke:acp
```

涉及平台行为时，请至少说明你实际验证的系统与架构。平台打包命令为：

```bash
pnpm dist:win   # Windows x64
pnpm dist:mac   # macOS arm64
```

## Pull Request 要求

PR 描述应包含：

- 问题、方案和不在本次范围内的内容；
- 运行过的验证命令与结果；
- Windows/macOS 行为差异；
- 界面修改前后的脱敏截图；
- 安全、隐私、持久化或权限边界变化；
- 关联 Issue，例如 `Closes #123`。

维护者可能要求缩小范围、补充测试或重新设计会扩大权限面的实现。没有测试或无法解释信任边界的高风险改动不会合并。

## 界面与文案

- 中文是产品的主要界面语言；新文案应简洁、可操作并避免把推测写成事实。
- 不使用 xAI/Grok 官方 Logo，不把“Grok”写入本项目产品名或自有标志。
- 截图必须使用虚构仓库、虚构路径和不含敏感信息的演示数据。
- 保持键盘可用性、焦点可见性和窄窗口布局。

## 许可证与第三方代码

新增依赖前请说明用途、维护状态和许可证。不得引入与 Apache-2.0 分发方式冲突的代码或素材。复制或改编第三方实现时必须保留其许可证和归属，并同步更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## English summary

Keep pull requests focused, use Conventional Commits, run `pnpm check`, document the platforms you tested, and never include credentials or private workspace content. Security issues must be reported privately. Contributions are accepted under Apache-2.0.
