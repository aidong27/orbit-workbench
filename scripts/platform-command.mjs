export function pnpmInvocation({
  npmExecPath = process.env.npm_execpath,
  nodeExecPath = process.execPath,
} = {}) {
  if (typeof npmExecPath !== 'string' || npmExecPath.trim().length === 0) {
    throw new Error('Run this license script through pnpm so npm_execpath is available');
  }

  return {
    executable: nodeExecPath,
    arguments: [npmExecPath],
  };
}
