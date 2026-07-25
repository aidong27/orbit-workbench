export interface GracefulProcessHandle {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: {
    destroyed: boolean;
    end(): unknown;
  };
  once(event: 'exit', listener: () => void): this;
  removeListener(event: 'exit', listener: () => void): this;
}

export interface GracefulShutdownOptions<TProcess extends GracefulProcessHandle> {
  cleanupAfterExit?: (child: TProcess) => Promise<void>;
  forceTerminate: (child: TProcess) => Promise<void>;
  graceTimeoutMs: number;
}

function hasExited(child: GracefulProcessHandle): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: GracefulProcessHandle, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(result);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
    if (hasExited(child)) finish(true);
  });
}

export async function gracefullyShutdownProcess<TProcess extends GracefulProcessHandle>(
  child: TProcess,
  options: GracefulShutdownOptions<TProcess>,
): Promise<void> {
  if (hasExited(child)) {
    await options.cleanupAfterExit?.(child);
    return;
  }

  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
    await options.forceTerminate(child);
    return;
  }
  if (await waitForExit(child, options.graceTimeoutMs)) {
    await options.cleanupAfterExit?.(child);
    return;
  }

  await options.forceTerminate(child);
}
