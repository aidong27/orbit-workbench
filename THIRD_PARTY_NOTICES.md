<!-- markdownlint-disable MD013 -->

# Third-Party Notices

Orbit Workbench is distributed under the Apache License 2.0. It also depends on third-party software released under separate licenses. Those licenses apply to their respective components and are not replaced by the project license.

The following list summarizes the direct runtime components in `0.2.0-alpha.4`. Complete license text for the production dependency graph and Electron is generated in [`THIRD_PARTY_LICENSES.txt`](THIRD_PARTY_LICENSES.txt); Electron's Chromium notices ship separately as `THIRD_PARTY_LICENSES.chromium.html`. Transitive dependency versions remain recorded in `pnpm-lock.yaml`.

## Apache License 2.0

### Agent Client Protocol TypeScript SDK

- Package: `@agentclientprotocol/sdk`
- Project: <https://github.com/agentclientprotocol/typescript-sdk>
- Copyright: its contributors
- License: Apache-2.0

The SDK is used to communicate with an ACP-compatible agent over stdio. Orbit Workbench does not copy or bundle the Grok Build CLI itself.

## MIT License

### Electron

- Project: <https://github.com/electron/electron>
- Copyright: OpenJS Foundation and Electron contributors
- License: MIT

### React and React DOM

- Packages: `react`, `react-dom`
- Project: <https://github.com/facebook/react>
- Copyright: Meta Platforms, Inc. and affiliates
- License: MIT

### React Markdown and remark-gfm

- Packages: `react-markdown`, `remark-gfm`
- Projects: <https://github.com/remarkjs/react-markdown>, <https://github.com/remarkjs/remark-gfm>
- Copyright: their contributors
- License: MIT

### clsx

- Package: `clsx`
- Project: <https://github.com/lukeed/clsx>
- Copyright: Luke Edwards
- License: MIT

### Zod

- Package: `zod`
- Project: <https://github.com/colinhacks/zod>
- Copyright: Colin McDonnell and contributors
- License: MIT

Runtime dependency trees also include MIT-licensed Unified, Micromark and related utilities. Their package metadata and license texts are available from the linked package sources and the installed dependency tree.

## ISC License

### Lucide

- Package: `lucide-react`
- Project: <https://github.com/lucide-icons/lucide>
- Copyright: Lucide contributors
- License: ISC

## Upstream compatible service

Grok Build CLI is a separate upstream program published by xAI under its own terms. It is discovered and launched from the user's machine; it is not included in Orbit Workbench installers.

- Official documentation: <https://docs.x.ai/build/overview>

## Complete license information

This file is an attribution aid, not a substitute for the full license texts. To inspect the dependency licenses for a specific source checkout, run:

```bash
pnpm licenses list --prod
```

If a packaged artifact omits a required third-party notice or license, please report it as a packaging bug.
