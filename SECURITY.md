<!-- markdownlint-disable MD013 -->

# 安全政策 / Security Policy

星轨工作台处理本地项目路径、对话文本和编码代理权限请求。我们希望所有安全报告都以保护用户数据和报告者隐私的方式处理。

## 支持范围

| 版本 | 安全更新 |
| --- | --- |
| `0.2.x` Alpha | 支持，尽力修复 |
| `< 0.2.0` | 不再支持 |

Alpha 版本仍在快速变化中，不应被视为已经过正式安全认证的软件。

## 私密报告漏洞

请使用 [GitHub Private Vulnerability Reporting](https://github.com/aidong27/orbit-workbench/security/advisories/new) 提交报告。**不要通过公开 Issue 报告未修复漏洞。**

报告中请尽量包含：

- 受影响的应用版本、操作系统和架构；
- Grok Build CLI 版本，但不要包含登录令牌；
- 最小复现步骤和预期/实际结果；
- 影响范围及你已经验证过的缓解方式；
- 必要的日志片段，且已经删除密钥、私有代码、用户名和绝对路径。

维护者会尽快确认收到报告，并在完成初步复现后沟通严重程度、修复计划和披露时间。复杂问题可能需要更长时间；在双方确定公开披露窗口前，请保持细节私密。

如果 Private Vulnerability Reporting 暂时不可用，请在普通 Issue 中仅说明“需要私密安全联系”，不要附带漏洞细节。

## 安全边界

- Grok Build 登录与模型访问由用户安装的 CLI 管理；界面与本地状态不读取或保存 `XAI_API_KEY`。Grok 子进程会继承应用启动环境，供 CLI 按其自身认证规则使用。
- 渲染进程启用 Electron 沙箱和上下文隔离，不能直接调用 Node.js、文件系统或子进程。
- 受限 IPC 将请求发送到主进程；路径、URL 和参数会在可信边界重新验证。
- Git 调用使用固定可执行程序和参数数组，不通过 shell 拼接输入。
- ACP 权限请求必须由用户选择；应用不会在界面层默认批准。
- 界面历史保存在本机，包含工作区路径、会话标题和裁剪后的对话文本。

## 不属于漏洞的情况

- Grok Build CLI 自身的问题，请报告给其上游项目。
- 模型回答的事实性或内容质量问题。
- 用户明确批准工具操作后产生的预期文件修改。
- 仅影响已停止支持版本、且在当前版本无法复现的问题。

## 安装包签名

`0.2.0-alpha.1` 的 Windows 和 macOS 包尚未进行商业代码签名或 Apple 公证。签名缺失会产生系统来源提示，但不应被当作绕过其他安全检查的理由。只从本仓库 Releases 获取产物，并核对发布页校验值；无法验证来源时请从源码构建。

## Disclosure in English

Please report vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/aidong27/orbit-workbench/security/advisories/new). Do not include secrets, private source code, usernames, or absolute local paths in public issues. The currently supported security line is `0.2.x` Alpha on a best-effort basis.
