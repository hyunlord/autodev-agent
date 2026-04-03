import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { VerifyTool, VerifyToolResult } from '../../interfaces';

export function createFileReadTool(projectDir: string): VerifyTool {
  return {
    name: 'file_read',
    description: 'Read file contents. Params: { path: "relative/path" } or { path: "." } to list files',
    async execute(params): Promise<VerifyToolResult> {
      try {
        const filePath = join(projectDir, (params.path as string) ?? '.');
        if (!existsSync(filePath)) {
          return { success: false, output: `File not found: ${params.path}` };
        }
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          const files = readdirSync(filePath, { recursive: true })
            .slice(0, 100)
            .map(String);
          return { success: true, output: `Files:\n${files.join('\n')}`, data: files };
        }
        if (stat.size > 50000) {
          const content = readFileSync(filePath, 'utf-8');
          const truncated = content.slice(0, 5000) + '\n...[truncated]...\n' + content.slice(-2000);
          return { success: true, output: truncated };
        }
        const content = readFileSync(filePath, 'utf-8');
        return { success: true, output: content };
      } catch (err) {
        return { success: false, output: `Error: ${err}` };
      }
    },
  };
}
