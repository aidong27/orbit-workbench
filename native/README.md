# Windows Job Object runner

`windows-job-runner.exe` is a 64-bit native supervisor used only by the Windows build.
It starts Grok suspended, assigns it to a private Windows Job Object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumes it and proxies the inherited
standard streams. The runner also watches the Electron parent process. Closing
either the runner or the Electron parent closes the Job Object and asks Windows
to terminate every remaining Grok descendant.

The checked-in binary is built reproducibly from
[`windows-job-runner.c`](windows-job-runner.c) with Zig 0.16.0:

```powershell
zig cc -target x86_64-windows-gnu -std=c17 -Os -s -municode `
  native/windows-job-runner.c -o build/windows-job-runner.exe
```

Expected SHA-256:

```text
eef8c5061b96a5ba76c3fd980c718761a7d269cc13def4fe23006df358054443
```

`pnpm windows:config:check` verifies the hash, PE32+ x64 headers, packaging
destination and required Win32 safety flags. The native Windows packaging job
also executes the packaged runner and proves that it preserves ACP stdio bytes
and kills a descendant after the direct child exits.
