import type { VerifyTool, VerifyToolResult } from '../../interfaces';

export function createShellExecTool(projectDir: string): VerifyTool {
  return {
    name: 'shell_exec',
    description: 'Execute a shell command. Params: { command: "npm run build" }',
    async execute(params): Promise<VerifyToolResult> {
      try {
        const { getExeca } = await import('../../../lib/execa');
        const ex = await getExeca();
        const result = await ex(params.command as string, {
          cwd: projectDir,
          shell: true,
          reject: false,
          timeout: 60_000,
        } as any);  // eslint-disable-line @typescript-eslint/no-explicit-any
        return {
          success: (result as any).exitCode === 0,
          output: `Exit: ${(result as any).exitCode}\nStdout:\n${((result as any).stdout ?? '').slice(0, 5000)}\nStderr:\n${((result as any).stderr ?? '').slice(0, 2000)}`,
          data: { exitCode: (result as any).exitCode },
        };
      } catch (err) {
        return { success: false, output: `Error: ${err}` };
      }
    },
  };
}
