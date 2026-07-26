<!-- markdownlint-disable MD013 MD033 MD041 -->

<p align="center">
  <img src="docs/assets/hero.svg" alt="Orbit Workbench" width="100%" />
</p>

<p align="center">
  <strong>A clear, reviewable desktop workflow for Grok Build CLI, designed Chinese-first.</strong>
</p>

<p align="center">
  <a href="https://github.com/aidong27/orbit-workbench/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/aidong27/orbit-workbench/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/aidong27/orbit-workbench/releases"><img alt="Release" src="https://img.shields.io/github/v/release/aidong27/orbit-workbench?include_prereleases&sort=semver&display_name=tag&style=flat-square" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/github/license/aidong27/orbit-workbench?style=flat-square" /></a>
  <img alt="Windows x64 and macOS arm64" src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-7c6af2?style=flat-square" />
  <img alt="Alpha" src="https://img.shields.io/badge/status-alpha-f0a45d?style=flat-square" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English ·
  <a href="https://github.com/aidong27/orbit-workbench/releases">Download</a> ·
  <a href="https://github.com/aidong27/orbit-workbench/issues/new/choose">Report an issue</a>
</p>

> [!IMPORTANT]
> **Orbit Workbench is an independent, unofficial community project.** It is not affiliated with, authorized, sponsored, or endorsed by xAI. “Grok” and “Grok Build” are used only to identify the compatible service. The app does not bundle Grok Build CLI or bypass its authentication and permission controls.

## Overview

Orbit Workbench gives an already-installed Grok Build CLI a Chinese desktop interface. It connects to `grok agent stdio` through the Agent Client Protocol (ACP), bringing projects, sessions, streamed responses, tool activity, and permission requests into one three-pane workspace.

<p align="center">
  <img src="docs/assets/workbench.png" alt="The Chinese three-pane Orbit Workbench interface" width="100%" />
</p>

| Capability | What it provides |
| --- | --- |
| Real ACP sessions | Streamed messages, summaries, plans, tool calls, and completion status from the local CLI. |
| Guided connection | Separates CLI detection from ACP readiness, with in-place retry and copyable redacted diagnostics. |
| Account control | Force-restarts the local agent for fresh authentication and provides an explicit, verified Grok logout flow. |
| Truthful state | History continuity, mode switches, and streamed messages reflect protocol-confirmed state rather than UI assumptions. |
| Chinese-first UX | Chinese workspace, command palette, settings, permission prompts, and errors. |
| Everyday usability | Larger text, an auto-growing composer, restart-safe per-session drafts, and searchable recent tasks. |
| Local-first boundary | Credentials, model requests, and tool execution stay with the user's CLI. |
| Explicit permissions | Sensitive ACP requests enter a visible queue and are never approved by the UI by default. |
| Git awareness | Current branch, changed files, and diff statistics without shell-interpolated arguments. |
| Two platforms | Windows x64 installer/portable packages and macOS arm64 DMG/ZIP packages. |

## Supported platforms

The current development source version is **`0.2.0-alpha.5`**. Downloadable builds remain whatever is explicitly listed on [Releases](https://github.com/aidong27/orbit-workbench/releases); do not treat a source version as an already-published package. Alpha builds are intended for testing and review, not irreplaceable workspaces.

| Platform | Architecture | Packages | Status |
| --- | --- | --- | --- |
| Windows | x64 | NSIS installer, portable executable | Alpha |
| macOS | Apple Silicon / arm64 | DMG, ZIP | Alpha |
| Linux | — | — | Not supported yet |

## Installation

1. Install and authenticate Grok Build CLI using the [official xAI documentation](https://docs.x.ai/build/overview), then verify `grok --version` and `grok login`.
2. Download only a tag and matching artifact that are actually present on [Releases](https://github.com/aidong27/orbit-workbench/releases). A development source version is not proof that its package has been published; do not rename an older artifact.
3. On Windows, the app checks `GROK_BINARY`, `GROK_BIN_DIR`, the official `%USERPROFILE%\.grok\bin\grok.exe` location, and absolute directories in `PATH`. It accepts only absolute file paths ending in `.exe`, not `.cmd` or `.bat` wrappers; the missing-CLI screen provides xAI's official PowerShell installer command as a copy-only action and warns that the pipeline downloads and immediately executes the script.

> [!WARNING]
> Current Alpha packages are not Windows Authenticode-signed. macOS packages are neither Apple Developer ID-signed nor notarized. Download only from this repository, verify the published checksums, and build from source when provenance cannot be confirmed.

On Windows, Grok runs behind an auditable, fixed-hash x64 Job Object supervisor. The CLI is created suspended, assigned to a kill-on-close job, and only then resumed, so the application does not mistake a terminated leader for a fully terminated process tree.

See the bilingual [installation guide](docs/INSTALLATION.md) for artifact names, checksum commands, and troubleshooting.

## Development

Node.js `24.18.0` and pnpm `11.12.0` are required.

```bash
git clone https://github.com/aidong27/orbit-workbench.git
cd orbit-workbench
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

```bash
pnpm check       # typecheck, lint, tests, and production build
pnpm smoke:acp   # local CLI handshake and session smoke test
pnpm dist:win    # Windows x64 packages
pnpm dist:mac    # macOS arm64 packages
```

## Security model

Orbit Workbench's UI and local state do not read or store `XAI_API_KEY`. The Grok child receives an allowlisted set of runtime, Grok/xAI, proxy, and certificate variables; Node/Electron injection variables are always blocked. The sandboxed renderer has no Node.js access. Raw ACP SDK objects are converted in the main process into typed, size-bounded display events before they cross validated IPC. Permission prompts identify their workspace, path, and session source. Persisted UI history and bounded per-session drafts use a validated, versioned v4 format; restored timelines remain local-history-only and do not imply that the upstream agent context was resumed.

Report vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/aidong27/orbit-workbench/security/advisories/new). Never post credentials, private source code, or local absolute paths in a public issue. See [SECURITY.md](SECURITY.md).

## Contributing and governance

- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Support policy](SUPPORT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [0.2.0-alpha.4 development snapshot notes](docs/RELEASE_NOTES.md)
- [Changelog](CHANGELOG.md)

## License and trademarks

Source code is licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

“Orbit Workbench” and “星轨工作台” are independent project names and marks. This project does not use the official xAI or Grok logos. See [TRADEMARKS.md](TRADEMARKS.md) for the full notice.
